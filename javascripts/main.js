// ===== Supabase 配置 =====
const SUPABASE_URL = 'https://mfmwgnolrhulmbkuftdh.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1mbXdnbm9scmh1bG1ia3VmdGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI0OTIyMzcsImV4cCI6MjA3ODA2ODIzN30.Nb2n0_8mHFIBZeDjnKuoe2Lvgw0B3O5chdRsZgTVets';

async function supabaseFetch(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`
    }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase ${res.status}: ${text}`);
  }
  return res.json();
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

// 从 Supabase 读取 quant_index，返回和原 parseCsv 一样的结构
async function loadIndexDataFromSupabase() {
  const rows = await supabaseFetch(
    'quant_index?select=ts,q2025,cmc20,cmc100,g2025,b2025&order=ts'
  );

  const cleanEntries = [];

  rows.forEach((r) => {
    const timestampRaw = r.ts;
    if (!timestampRaw) return;

    const q2025Value = parseFloat(normalizeNumberString(r.q2025));
    const cmc20Value = parseFloat(normalizeNumberString(r.cmc20));
    const cmc100Value = parseFloat(normalizeNumberString(r.cmc100));
    const g2025Candidate = parseFloat(normalizeNumberString(r.g2025));
    const b2025Candidate = parseFloat(normalizeNumberString(r.b2025));

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

    const time = new Date(timestampRaw);
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

document.addEventListener('DOMContentLoaded', () => {
  const yearEl = document.getElementById('current-year');
  if (yearEl) {
    yearEl.textContent = new Date().getFullYear();
  }

  const tickerEl = document.getElementById('coin-ticker');
  const highlightsEl = document.getElementById('index-highlights');
  const updatedEl = document.getElementById('chart-updated');
  const rangeLabelEl = document.getElementById('range-label');
  const percentToggle = document.getElementById('mode-percent');
  const absoluteToggle = document.getElementById('mode-absolute');
  const rangeAllToggle = document.getElementById('range-all');
  const range72hToggle = document.getElementById('range-72h');
  const chartContainer = document.getElementById('index-chart');
  const tickerStrip = document.querySelector('.ticker-strip');
  const tickerToggleBtn = document.getElementById('ticker-toggle');
  const mobileTickerMedia = window.matchMedia('(max-width: 991.98px)');
  const landscapeTickerMedia = window.matchMedia(
    '(orientation: landscape) and (max-width: 991.98px)'
  );
  let lastScrollY = window.scrollY;

  const resetTickerToggle = () => {
    if (!tickerToggleBtn) {
      return;
    }
    tickerToggleBtn.setAttribute('aria-expanded', 'false');
    tickerToggleBtn.textContent = '行情';
  };

  const handleTickerScroll = () => {
    if (!tickerStrip) {
      return;
    }
    if (!landscapeTickerMedia.matches) {
      tickerStrip.classList.remove('ticker-hidden');
      lastScrollY = window.scrollY;
      return;
    }
    const currentY = window.scrollY;
    const nearTop = currentY <= 8;
    if (nearTop) {
      tickerStrip.classList.remove('ticker-hidden');
      lastScrollY = currentY;
      return;
    }
    const scrollingDown = currentY > lastScrollY + 4;
    const scrollingUp = currentY < lastScrollY - 4;
    if (scrollingDown) {
      tickerStrip.classList.add('ticker-hidden');
    } else if (scrollingUp) {
      tickerStrip.classList.remove('ticker-hidden');
    }
    lastScrollY = currentY;
  };

  tickerToggleBtn?.addEventListener('click', () => {
    if (!tickerStrip) {
      return;
    }
    const expanded = tickerStrip.classList.toggle('is-expanded');
    if (expanded) {
      tickerStrip.classList.remove('ticker-hidden');
    } else {
      handleTickerScroll();
    }
    tickerToggleBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    tickerToggleBtn.textContent = expanded ? '收起行情' : '行情';
  });

  const handleTickerMediaChange = (event) => {
    if (!tickerStrip) {
      return;
    }
    if (!event.matches) {
      tickerStrip.classList.remove('is-expanded');
      resetTickerToggle();
    } else {
      tickerStrip.classList.remove('is-expanded');
      resetTickerToggle();
    }
    tickerStrip.classList.remove('ticker-hidden');
    lastScrollY = window.scrollY;
  };

  if (mobileTickerMedia.addEventListener) {
    mobileTickerMedia.addEventListener('change', handleTickerMediaChange);
  } else if (mobileTickerMedia.addListener) {
    mobileTickerMedia.addListener(handleTickerMediaChange);
  }

  if (landscapeTickerMedia.addEventListener) {
    landscapeTickerMedia.addEventListener('change', () => {
      tickerStrip?.classList.remove('ticker-hidden');
      lastScrollY = window.scrollY;
      handleTickerScroll();
    });
  } else if (landscapeTickerMedia.addListener) {
    landscapeTickerMedia.addListener(() => {
      tickerStrip?.classList.remove('ticker-hidden');
      lastScrollY = window.scrollY;
      handleTickerScroll();
    });
  }

  window.addEventListener('scroll', handleTickerScroll, { passive: true });

  resetTickerToggle();
  handleTickerScroll();

  if (!chartContainer || typeof echarts === 'undefined') {
    console.warn('ECharts not available, chart will not render.');
    return;
  }

  // ===== market：改为从 Supabase 读取 =====
  loadMarketDataFromSupabase()
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
    });

  // ===== index：改为从 Supabase 读取 =====
  loadIndexDataFromSupabase()
    .then((parsed) => {
      if (!parsed.length) {
        throw new Error('指数数据为空');
      }
      const chart = echarts.init(chartContainer, null, { renderer: 'canvas' });
      const state = {
        mode: 'absolute',
        range: 'all',
        rawData: parsed,
        data: filterDataByRange(parsed, 'all'),
        chart
      };

      updateChart(state);
      updateHighlights(state, highlightsEl, updatedEl, rangeLabelEl);

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
          state.range = 'all';
          state.data = filterDataByRange(state.rawData, state.range);
          updateChart(state);
          updateHighlights(state, highlightsEl, updatedEl, rangeLabelEl);
        }
      });

      range72hToggle?.addEventListener('change', () => {
        if (range72hToggle.checked) {
          state.range = '72h';
          state.data = filterDataByRange(state.rawData, state.range);
          updateChart(state);
          updateHighlights(state, highlightsEl, updatedEl, rangeLabelEl);
        }
      });
    })
    .catch((error) => {
      console.error('加载 Supabase quant_index 失败:', error);
      if (updatedEl) {
        updatedEl.textContent = `加载失败：${error.message}`;
      }
      if (rangeLabelEl) {
        rangeLabelEl.textContent = '--';
      }
    });
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

function updateChart(state) {
  const { chart, data, rawData, mode } = state;
  if (!chart || !data.length) {
    return;
  }

  const seriesConfig = [
    {
      key: 'q2025',
      name: 'Q2025',
      color: '#2fb344'
    },
    {
      key: 'g2025',
      name: 'G2025',
      color: '#a855f7'
    },
    {
      key: 'b2025',
      name: 'B2025',
      color: '#0ea5e9'
    },
    {
      key: 'cmc20',
      name: 'CMC20',
      color: '#4c6ef5'
    },
    {
      key: 'cmc100',
      name: 'CMC100',
      color: '#fa8c16'
    }
  ];

  const baseValues = seriesConfig.reduce((acc, serie) => {
    const baseEntry =
      (Array.isArray(data) ? data : []).find((entry) =>
        Number.isFinite(entry[serie.key])
      ) ||
      (Array.isArray(rawData) ? rawData : []).find((entry) =>
        Number.isFinite(entry[serie.key])
      );
    acc[serie.key] = baseEntry ? baseEntry[serie.key] : NaN;
    return acc;
  }, {});

  const series = seriesConfig.map((serie) => ({
    name: serie.name,
    type: 'line',
    smooth: true,
    symbol: 'none',
    lineStyle: {
      width: 3,
      color: serie.color
    },
    emphasis: {
      scale: true
    },
    data: data.map((entry) => {
      const raw = entry[serie.key];
      if (!Number.isFinite(raw)) {
        return [entry.time, null];
      }
      const baseValue = baseValues[serie.key];
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
    color: seriesConfig.map((serie) => serie.color),
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
      min: (value) => value.min,
      max: (value) => value.max
    },
    series
  };

  chart.setOption(option, true);
}

function updateHighlights(state, highlightsEl, updatedEl, rangeLabelEl) {
  const { data, range } = state;
  if (!data || !data.length) {
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
    rangeLabelEl.textContent = range === '72h' ? '72H' : 'ALL';
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

  const metrics = [
    { key: 'q2025', label: 'Q2025' },
    { key: 'g2025', label: 'G2025' },
    { key: 'b2025', label: 'B2025' },
    { key: 'cmc20', label: 'CMC20' },
    { key: 'cmc100', label: 'CMC100' }
  ];

  const reversedData = [...data].reverse();
  const items = metrics
    .map(({ key, label }) => {
      const firstValid = data.find((entry) => Number.isFinite(entry[key]));
      const lastValid = reversedData.find((entry) => Number.isFinite(entry[key]));
      if (!firstValid || !lastValid) {
        return '';
      }
      return makeListItem(label, lastValid[key], firstValid[key]);
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
  if (range !== '72h' || !Array.isArray(data) || !data.length) {
    return data;
  }

  const latest = data[data.length - 1];
  if (!latest || !(latest.time instanceof Date)) {
    return data;
  }

  const cutoff = latest.time.getTime() - 72 * 60 * 60 * 1000;
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
