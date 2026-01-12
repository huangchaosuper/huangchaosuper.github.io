// ===== Supabase 配置 =====
const SUPABASE_URL = 'https://mfmwgnolrhulmbkuftdh.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1mbXdnbm9scmh1bG1ia3VmdGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI0OTIyMzcsImV4cCI6MjA3ODA2ODIzN30.Nb2n0_8mHFIBZeDjnKuoe2Lvgw0B3O5chdRsZgTVets';

async function supabaseFetch(path, fetchOptions = {}) {
  const { headers: extraHeaders = {}, ...restOptions } = fetchOptions;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      ...extraHeaders
    },
    ...restOptions
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase ${res.status}: ${text}`);
  }
  return res.json();
}

async function supabaseFetchAllPages(baseQuery, pageSize = 1000) {
  const results = [];
  const connector = baseQuery.includes('?') ? '&' : '?';
  const MAX_PAGES = 50;
  let page = 0;

  while (page < MAX_PAGES) {
    const offset = page * pageSize;
    const pagedQuery = `${baseQuery}${connector}limit=${pageSize}&offset=${offset}`;
    const chunk = await supabaseFetch(pagedQuery);
    results.push(...chunk);
    if (chunk.length < pageSize) {
      break;
    }
    page += 1;
  }

  if (page === MAX_PAGES) {
    throw new Error('Supabase 返回数据超过分页上限，请缩小时间范围');
  }

  return results;
}

// 从 Supabase 读取 market_data，返回 [{symbol,name,price,change}, ...]
async function loadMarketDataFromSupabase() {
  const rows = await supabaseFetch(
    'market_data?select=ticker,price,price_percentage_change_24h'
  );

  return rows
    .map((r) => {
      const price = parseFloat(normalizeNumberString(r.price));
      const change = parseFloat(
        normalizeNumberString(r.price_percentage_change_24h)
      );
      if (!r.ticker || Number.isNaN(price) || Number.isNaN(change)) {
        return null;
      }
      return {
        symbol: r.ticker,
        name: COIN_NAME_FALLBACKS[r.ticker] || r.ticker,
        price,
        change
      };
    })
    .filter(Boolean);
}

// 从 Supabase 读取 coin_index 或聚合视图（竖表），返回按时间整合后的结构（动态指标）
async function loadIndexDataFromSupabase(range = 'all') {
  const RANGE_TO_HOURS = {
    '24h': 24,
    '72h': 72,
    '7d': 7 * 24,
    '30d': 30 * 24
  };

  const VIEW_CONFIG = {
    all: {
      table: 'coin_index_daily',
      timestampField: 'ts_bucket'
    },
    hourly: {
      table: 'coin_index_hourly',
      timestampField: 'ts_bucket'
    }
  };

  const useHourlyView = range === '7d' || range === '30d';
  const useDailyView = range === 'all';
  const table = useDailyView
    ? VIEW_CONFIG.all.table
    : useHourlyView
      ? VIEW_CONFIG.hourly.table
      : 'coin_index';
  const timestampField = useDailyView
    ? VIEW_CONFIG.all.timestampField
    : useHourlyView
      ? VIEW_CONFIG.hourly.timestampField
      : 'ts';

  const baseSelect = `${table}?select=${timestampField},portfolio,value&order=${timestampField}`;
  const hours = RANGE_TO_HOURS[range];
  const rows = await (() => {
    if (hours) {
      const cutoffIso = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
      const query = `${baseSelect}&${timestampField}=gte.${encodeURIComponent(
        cutoffIso
      )}`;
      return supabaseFetchAllPages(query);
    }
    return supabaseFetchAllPages(baseSelect);
  })();

  const parsed = transformCoinIndexRows(rows);
  return { entries: parsed.entries, metricKeys: parsed.metricKeys };
}

const RANGE_LABELS = {
  all: 'ALL',
  '30d': '30D',
  '7d': '7D',
  '72h': '72H',
  '24h': '24H'
};

document.addEventListener('DOMContentLoaded', () => {
  const yearEl = document.getElementById('current-year');
  if (yearEl) {
    yearEl.textContent = new Date().getFullYear();
  }

  const tickerEl = document.getElementById('coin-ticker');
  const marketRefreshBtn = document.getElementById('refresh-market');
  const highlightsEl = document.getElementById('index-highlights');
  const updatedEl = document.getElementById('chart-updated');
  const rangeLabelEl = document.getElementById('range-label');
  const indexTitleEl = document.getElementById('index-title');
  const percentToggle = document.getElementById('mode-percent');
  const absoluteToggle = document.getElementById('mode-absolute');
  const rangeAllToggle = document.getElementById('range-all');
  const range30dToggle = document.getElementById('range-30d');
  const range7dToggle = document.getElementById('range-7d');
  const range72hToggle = document.getElementById('range-72h');
  const range24hToggle = document.getElementById('range-24h');
  const chartContainer = document.getElementById('index-chart');

  const refreshMarketData = () => {
    if (tickerEl) {
      tickerEl.innerHTML =
        '<div class="text-muted small py-3">数据刷新中…</div>';
    }
    setButtonLoading(marketRefreshBtn, true);
    return loadMarketDataFromSupabase()
      .then((coins) => {
        if (!coins.length) {
          throw new Error('币种数据为空');
        }
        renderTicker(coins, tickerEl);
      })
      .catch((error) => {
        console.error('加载 Supabase market_data 失败:', error);
        if (tickerEl) {
          tickerEl.innerHTML = `<div class="text-danger small">${error.message}</div>`;
        }
      })
      .finally(() => {
        setButtonLoading(marketRefreshBtn, false);
      });
  };

  marketRefreshBtn?.addEventListener('click', () => {
    refreshMarketData();
  });

  refreshMarketData();

  if (!chartContainer || typeof echarts === 'undefined') {
    console.warn('ECharts not available, chart will not render.');
    return;
  }

  // ===== index：按范围从 Supabase 读取 =====
  const chart = echarts.init(chartContainer, null, { renderer: 'canvas' });
  const state = {
    mode: 'absolute',
    range: '24h',
    rawData: [],
    rawDataByRange: {},
    metricKeys: [],
    data: [],
    chart
  };

  const updateMetricTitle = (metricKeys = []) => {
    if (!indexTitleEl) {
      return;
    }
    const metrics = Array.isArray(metricKeys)
      ? metricKeys
          .filter((key) => typeof key === 'string' && key.trim())
          .map((key) => key.toUpperCase())
      : [];
    const fallback = indexTitleEl.dataset.defaultTitle || indexTitleEl.textContent;
    if (!metrics.length) {
      indexTitleEl.textContent = fallback || 'Crypto Index';
      return;
    }
    indexTitleEl.textContent = metrics.join(' · ');
  };

  const renderState = () => {
    if (!state.data.length || !state.metricKeys?.length) {
      return;
    }
    updateMetricTitle(state.metricKeys);
    updateChart(state);
    updateHighlights(state, highlightsEl, updatedEl, rangeLabelEl);
  };

  const setRangeLabel = (range) => {
    if (rangeLabelEl) {
      rangeLabelEl.textContent = RANGE_LABELS[range] || 'ALL';
    }
  };

  let activeRangeRequestId = 0;

  const loadRangeData = (range, { force = false } = {}) => {
    const cached = state.rawDataByRange[range];
    if (
      !force &&
      cached &&
      Array.isArray(cached.entries) &&
      cached.entries.length
    ) {
      state.rawData = cached.entries;
      state.metricKeys = cached.metricKeys;
      state.data = filterDataByRange(cached.entries, range);
      updateMetricTitle(state.metricKeys);
      renderState();
      return Promise.resolve();
    }

    activeRangeRequestId += 1;
    const requestId = activeRangeRequestId;

    if (updatedEl) {
      updatedEl.textContent = '数据加载中…';
    }

    return loadIndexDataFromSupabase(range)
      .then((parsed) => {
        if (!parsed.entries.length || !parsed.metricKeys.length) {
          throw new Error('指数数据为空');
        }
        state.rawDataByRange[range] = parsed;
        if (requestId !== activeRangeRequestId || state.range !== range) {
          return;
        }
        state.rawData = parsed.entries;
        state.metricKeys = parsed.metricKeys;
        state.data = filterDataByRange(parsed.entries, range);
        updateMetricTitle(state.metricKeys);
        renderState();
      })
      .catch((error) => {
        console.error('加载 Supabase coin_index 失败:', error);
        if (requestId !== activeRangeRequestId || state.range !== range) {
          return;
        }
        if (updatedEl) {
          updatedEl.textContent = `加载失败：${error.message}`;
        }
        if (rangeLabelEl) {
          rangeLabelEl.textContent = '--';
        }
      });
  };

  const activateRange = (range) => {
    state.range = range;
    setRangeLabel(range);
    loadRangeData(range);
  };

  window.addEventListener('resize', () => {
    chart.resize();
  });

  absoluteToggle?.addEventListener('change', () => {
    if (absoluteToggle.checked) {
      state.mode = 'absolute';
      updateChart(state);
    }
  });

  percentToggle?.addEventListener('change', () => {
    if (percentToggle.checked) {
      state.mode = 'percent';
      updateChart(state);
    }
  });

  rangeAllToggle?.addEventListener('change', () => {
    if (rangeAllToggle.checked) {
      activateRange('all');
    }
  });

  range72hToggle?.addEventListener('change', () => {
    if (range72hToggle.checked) {
      activateRange('72h');
    }
  });

  range7dToggle?.addEventListener('change', () => {
    if (range7dToggle.checked) {
      activateRange('7d');
    }
  });

  range30dToggle?.addEventListener('change', () => {
    if (range30dToggle.checked) {
      activateRange('30d');
    }
  });

  range24hToggle?.addEventListener('change', () => {
    if (range24hToggle.checked) {
      activateRange('24h');
    }
  });

  const indexRefreshBtn = document.getElementById('refresh-index');
  indexRefreshBtn?.addEventListener('click', () => {
    setButtonLoading(indexRefreshBtn, true);
    loadRangeData(state.range, { force: true }).finally(() => {
      setButtonLoading(indexRefreshBtn, false);
    });
  });

  setRangeLabel(state.range);
  activateRange(state.range);
});

const COIN_NAME_FALLBACKS = {
  BTC: 'Bitcoin',
  ETH: 'Ethereum',
  SOL: 'Solana',
  BNB: 'BNB',
  DOGE: 'Dogecoin',
  XRP: 'XRP',
  ADA: 'Cardano',
  ATOM: 'Cosmos',
  AVAX: 'Avalanche'
};

function setButtonLoading(button, isLoading, loadingLabel = '刷新中…') {
  if (!button) {
    return;
  }
  if (!button.dataset.defaultLabel) {
    button.dataset.defaultLabel = button.innerHTML;
  }
  if (isLoading) {
    button.disabled = true;
    button.innerHTML = loadingLabel;
  } else {
    button.disabled = false;
    button.innerHTML = button.dataset.defaultLabel;
  }
}

function renderTicker(coins, tickerEl) {
  if (!tickerEl) {
    return;
  }

  const currencyFormatter = {
    format: (value) => {
      const str = value.toString();
      const decimalPart = str.includes('.') ? str.split('.')[1] : '';
      const digits = Math.min(decimalPart.length, 8); // 最多8位小数
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: digits,
        maximumFractionDigits: digits
      }).format(value);
    }
  };

  tickerEl.innerHTML = '';
  coins.forEach((coin) => {
    const changeClass = coin.change >= 0 ? 'text-success' : 'text-danger';
    const changePrefix = coin.change >= 0 ? '+' : '';
    const card = document.createElement('div');
    card.className = 'coin-card';
    card.innerHTML = `
      <div class="coin-symbol">${coin.symbol}</div>
      <div class="coin-name text-muted">${coin.name}</div>
      <div class="coin-price fw-semibold">${currencyFormatter.format(coin.price)}</div>
      <div class="coin-change ${changeClass}">${changePrefix}${coin.change.toFixed(
        2
      )}%</div>
    `;
    tickerEl.appendChild(card);
  });
}

function parseMarketCsv(input) {
  return input
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .filter(Boolean)
    .map((line) => {
      const segments = line.split(',');
      if (segments.length < 3) {
        return null;
      }
      const symbol = segments[0].trim();
      const change = parseFloat(
        normalizeNumberString(segments[segments.length - 1])
      );
      const priceRaw = segments.slice(1, -1).join(',');
      const price = parseFloat(normalizeNumberString(priceRaw));
      if (!symbol || Number.isNaN(price) || Number.isNaN(change)) {
        return null;
      }
      return {
        symbol,
        name: COIN_NAME_FALLBACKS[symbol] || symbol,
        price,
        change
      };
    })
    .filter(Boolean);
}

function parseCsv(input) {
  const cleanEntries = [];

  input
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .filter(Boolean)
    .forEach((line) => {
      const segments = line.split(',');
      if (segments.length < 4) {
        return;
      }

      const [
        timestampRaw = '',
        q2025Raw = '',
        cmc20Raw = '',
        cmc100Raw = '',
        g2025Raw = '',
        b2025Raw = ''
      ] = segments;
      if (!timestampRaw.trim()) {
        return;
      }

      const q2025Value = parseFloat(normalizeNumberString(q2025Raw));
      const cmc20Value = parseFloat(normalizeNumberString(cmc20Raw));
      const cmc100Value = parseFloat(normalizeNumberString(cmc100Raw));
      const g2025Candidate = parseFloat(normalizeNumberString(g2025Raw));
      const b2025Candidate = parseFloat(normalizeNumberString(b2025Raw));

      const hasDirtyMetric = (value) => !Number.isFinite(value) || value < 0;
      if ([q2025Value, cmc20Value, cmc100Value].some(hasDirtyMetric)) {
        return;
      }

      const g2025Value =
        Number.isFinite(g2025Candidate) && g2025Candidate >= 0
          ? g2025Candidate
          : null;
      const b2025Value =
        Number.isFinite(b2025Candidate) && b2025Candidate >= 0
          ? b2025Candidate
          : null;

      const time = new Date(timestampRaw.replace(' ', 'T'));
      if (Number.isNaN(time.valueOf())) {
        return;
      }

      cleanEntries.push({
        timestamp: timestampRaw,
        time,
        q2025: q2025Value,
        g2025: g2025Value,
        b2025: b2025Value,
        cmc20: cmc20Value,
        cmc100: cmc100Value
      });
    });

  return cleanEntries;
}

function transformCoinIndexRows(rows) {
  if (!Array.isArray(rows) || !rows.length) {
    return { entries: [], metricKeys: [] };
  }

  const metricSet = new Set();
  const metricOrder = [];
  const entriesByTime = new Map();

  rows.forEach((row) => {
    const timestampRaw =
      row.timestamp || row.ts || row.bucket_ts || row.ts_bucket || row.ts_hour;
    const portfolioRaw = (row.portfolio || row.name || '').toString().trim();
    if (!timestampRaw || !portfolioRaw) {
      return;
    }

    const metricKey = portfolioRaw;
    if (!metricSet.has(metricKey)) {
      metricSet.add(metricKey);
      metricOrder.push(metricKey);
    }

    const value = parseFloat(normalizeNumberString(row.value));
    if (!Number.isFinite(value) || value < 0) {
      return;
    }
    const time = new Date(timestampRaw);
    if (Number.isNaN(time.valueOf())) {
      return;
    }
    const bucketKey = time.toISOString();
    if (!entriesByTime.has(bucketKey)) {
      entriesByTime.set(bucketKey, {
        timestamp: bucketKey,
        time
      });
    }
    const entry = entriesByTime.get(bucketKey);
    entry[metricKey] = value;
  });

  const entries = Array.from(entriesByTime.values()).sort((a, b) => a.time - b.time);
  return { entries, metricKeys: metricOrder };
}

function updateChart(state) {
  const { chart, data, rawData, mode, metricKeys } = state;
  if (!chart || !data.length || !Array.isArray(metricKeys) || !metricKeys.length) {
    return;
  }

  const COLOR_PALETTE = [
    '#2fb344',
    '#a855f7',
    '#0ea5e9',
    '#4c6ef5',
    '#fa8c16',
    '#ef4444',
    '#14b8a6',
    '#94a3b8',
    '#f59e0b',
    '#7c3aed'
  ];

  const baseValues = metricKeys.reduce((acc, key) => {
    const baseEntry =
      (Array.isArray(data) ? data : []).find((entry) => Number.isFinite(entry[key])) ||
      (Array.isArray(rawData) ? rawData : []).find((entry) => Number.isFinite(entry[key]));
    acc[key] = baseEntry ? baseEntry[key] : NaN;
    return acc;
  }, {});

  const series = metricKeys.map((key, idx) => ({
    name: key,
    type: 'line',
    smooth: true,
    symbol: 'none',
    lineStyle: {
      width: 3,
      color: COLOR_PALETTE[idx % COLOR_PALETTE.length]
    },
    emphasis: {
      scale: true
    },
    data: data.map((entry) => {
      const raw = entry[key];
      if (!Number.isFinite(raw)) {
        return [entry.time, null];
      }
      const baseValue = baseValues[key];
      const value =
        mode === 'percent' && Number.isFinite(baseValue)
          ? normalizePercent(raw, baseValue)
          : mode === 'percent'
            ? null
            : raw;
      return [entry.time, Number.isFinite(value) ? value : null];
    })
  }));

  const option = {
    color: metricKeys.map(
      (key, idx) => COLOR_PALETTE[idx % COLOR_PALETTE.length]
    ),
    backgroundColor: 'transparent',
    animation: true,
    tooltip: {
      trigger: 'axis',
      axisPointer: {
        lineStyle: {
          color: '#262626',
          width: 1,
          type: 'dashed'
        }
      },
      valueFormatter: (val) => formatValue(val, mode)
    },
    legend: {
      data: series.map((serie) => serie.name),
      top: 12,
      right: 16,
      textStyle: {
        color: '#1f2933',
        fontWeight: 600
      }
    },
    grid: {
      top: 64,
      left: 56,
      right: 32,
      bottom: 48
    },
    xAxis: {
      type: 'time',
      axisLine: {
        lineStyle: {
          color: '#adb5bd'
        }
      },
      axisLabel: {
        color: '#495057'
      },
      splitLine: {
        show: true,
        lineStyle: {
          color: '#edf2ff'
        }
      }
    },
    yAxis: {
      type: 'value',
      axisLine: {
        show: false
      },
      axisLabel: {
        color: '#495057',
        formatter: (value) => formatValue(value, mode)
      },
      splitLine: {
        show: true,
        lineStyle: {
          color: '#e9ecef'
        }
      },
      min: 'dataMin',
      max: 'dataMax'
    },
    series
  };

  chart.setOption(option, true);
}

function updateHighlights(state, highlightsEl, updatedEl, rangeLabelEl) {
  const { data, range, metricKeys } = state;
  if (!data || !data.length || !metricKeys?.length) {
    return;
  }

  const last = data[data.length - 1];

  const formatter = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  const latestText = `最新更新时间：${formatter.format(last.time)}`;

  if (updatedEl) {
    updatedEl.textContent = latestText;
  }

  if (rangeLabelEl) {
    rangeLabelEl.textContent = RANGE_LABELS[range] || 'ALL';
  }

  if (!highlightsEl) {
    return;
  }

  const makeListItem = (label, finalValue, firstValue) => {
    const delta = finalValue - firstValue;
    const pct = firstValue ? (delta / firstValue) * 100 : 0;
    const direction = delta >= 0 ? 'positive' : 'negative';
    const sign = delta >= 0 ? '+' : '';
    const currency = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 2
    });

    return `
      <li class="d-flex justify-content-between align-items-baseline py-2 border-bottom border-light-subtle">
        <span class="fw-semibold text-uppercase">${label}</span>
        <span class="text-nowrap">
          <span class="me-3">${currency.format(finalValue)}</span>
          <span class="badge rounded-pill bg-${
            direction === 'positive' ? 'success' : 'danger'
          } bg-opacity-10 text-${
            direction === 'positive' ? 'success' : 'danger'
          }">${sign}${pct.toFixed(2)}%</span>
        </span>
      </li>
    `;
  };

  const reversedData = [...data].reverse();
  const items = metricKeys
    .map((key) => {
      const firstValid = data.find((entry) => Number.isFinite(entry[key]));
      const lastValid = reversedData.find((entry) => Number.isFinite(entry[key]));
      if (!firstValid || !lastValid) {
        return '';
      }
      return makeListItem(key, lastValid[key], firstValid[key]);
    })
    .filter(Boolean);

  items.push(`<li class="pt-3 small text-muted">数据点数量：${data.length}</li>`);
  highlightsEl.innerHTML = items.join('');
}

function normalizePercent(value, base) {
  if (base === 0 || !Number.isFinite(base)) {
    return 0;
  }
  return ((value - base) / base) * 100;
}

function filterDataByRange(data, range) {
  if (!Array.isArray(data) || !data.length) {
    return data;
  }

  const RANGE_IN_HOURS = {
    '30d': 30 * 24,
    '7d': 7 * 24,
    '72h': 72,
    '24h': 24
  };

  const hours = RANGE_IN_HOURS[range];
  if (!hours) {
    return data;
  }

  const latest = data[data.length - 1];
  if (!latest || !(latest.time instanceof Date)) {
    return data;
  }

  const cutoff = latest.time.getTime() - hours * 60 * 60 * 1000;
  return data.filter(
    (item) => item.time instanceof Date && item.time.getTime() >= cutoff
  );
}

function formatValue(value, mode) {
  if (!Number.isFinite(value)) {
    return '';
  }
  if (mode === 'percent') {
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: value >= 1000 ? 2 : 4
  }).format(value);
}

function normalizeNumberString(raw) {
  if (!raw) {
    return 'NaN';
  }

  let value = String(raw).replace(/["\s]/g, '');
  if (!value) {
    return 'NaN';
  }

  // 1️⃣ 普通小数：只包含数字和最多一个点，例如 2.261、103140.1、0.5413
  if (/^\d+(\.\d+)?$/.test(value)) {
    return value;
  }

  // 2️⃣ 只用逗号做小数点（没有千分位），例如 101715,30
  if (/^\d+(,\d+)?$/.test(value) && value.includes(',')) {
    return value.replace(',', '.');
  }

  // 3️⃣ 美式千分位：1,234,567.89
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(value)) {
    return value.replace(/,/g, '');
  }

  // 4️⃣ 欧式千分位：1.234.567,89
  //    这里要求同时出现 '.' 和 ','，避免把 2.261 这种普通小数当成千分位
  if (
    value.includes('.') &&
    value.includes(',') &&
    /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(value)
  ) {
    return value.replace(/\./g, '').replace(',', '.');
  }

  // 兜底
  return value;
}

function bucketEntriesByHour(entries, metricKeys = []) {
  if (!Array.isArray(entries) || !entries.length) {
    return entries || [];
  }

  const keys =
    Array.isArray(metricKeys) && metricKeys.length
      ? metricKeys
      : Array.from(
          entries.reduce((set, entry) => {
            Object.keys(entry).forEach((key) => {
              if (key !== 'time' && key !== 'timestamp') {
                set.add(key);
              }
            });
            return set;
          }, new Set())
        );

  const BUCKET_MS = 60 * 60 * 1000;
  const aggregates = new Map();

  entries.forEach((entry) => {
    if (!(entry.time instanceof Date)) {
      return;
    }
    const bucketTimestamp = Math.floor(entry.time.getTime() / BUCKET_MS) * BUCKET_MS;
    const bucketKey = new Date(bucketTimestamp).toISOString();
    if (!aggregates.has(bucketKey)) {
      aggregates.set(bucketKey, {
        time: new Date(bucketTimestamp),
        timestamp: bucketKey,
        metrics: keys.reduce((acc, key) => {
          acc[key] = { sum: 0, count: 0 };
          return acc;
        }, {})
      });
    }
    const bucket = aggregates.get(bucketKey);
    keys.forEach((key) => {
      const value = entry[key];
      if (Number.isFinite(value)) {
        bucket.metrics[key].sum += value;
        bucket.metrics[key].count += 1;
      }
    });
  });

  const aggregateEntries = Array.from(aggregates.values())
    .map((bucket) => {
      const averaged = {};
      Object.entries(bucket.metrics).forEach(([key, { sum, count }]) => {
        averaged[key] = count ? sum / count : null;
      });
      return {
        timestamp: bucket.timestamp,
        time: bucket.time,
        ...averaged
      };
    })
    .filter((entry) =>
      Object.entries(entry).some(
        ([key, value]) =>
          key !== 'time' &&
          key !== 'timestamp' &&
          value &&
          typeof value === 'number' &&
          Number.isFinite(value)
      )
    )
    .sort((a, b) => a.time - b.time);

  return aggregateEntries;
}
