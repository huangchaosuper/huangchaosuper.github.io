// ===== Supabase 配置（China Stock）=====
const STOCK_SUPABASE_URL = 'https://comxwdqidehewaneyede.supabase.co';
const STOCK_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNvbXh3ZHFpZGVoZXdhbmV5ZWRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI3NjE1MDMsImV4cCI6MjA3ODMzNzUwM30.aWOA-GclNO2bTNZg-sgeepN74ZctE3_wZh_6jp9KZIg';

async function supabaseFetchStock(path, fetchOptions = {}) {
  const { headers: extraHeaders = {}, ...restOptions } = fetchOptions;
  const res = await fetch(`${STOCK_SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: STOCK_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${STOCK_SUPABASE_ANON_KEY}`,
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

async function supabaseFetchStockPages(baseQuery, pageSize = 1000) {
  const all = [];
  const connector = baseQuery.includes('?') ? '&' : '?';
  const MAX_PAGES = 50;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const offset = page * pageSize;
    const chunk = await supabaseFetchStock(
      `${baseQuery}${connector}limit=${pageSize}&offset=${offset}`
    );
    all.push(...chunk);
    if (chunk.length < pageSize) {
      return all;
    }
  }
  throw new Error('Supabase 数据超过分页上限，请缩小时间范围');
}

const STOCK_RANGE_LABELS = {
  all: 'ALL',
  '30d': '30D',
  '7d': '7D',
  '72h': '72H',
  '24h': '24H'
};

async function loadStockIndexData(range = '24h') {
  const RANGE_TO_HOURS = {
    '24h': 24,
    '72h': 72,
    '7d': 7 * 24,
    '30d': 30 * 24
  };

  const baseSelect =
    'stock_index?select=timestamp,portfolio,value&order=timestamp';
  const hours = RANGE_TO_HOURS[range];
  if (!hours && range !== 'all') {
    throw new Error(`不支持的范围：${range}`);
  }

  if (!hours) {
    return supabaseFetchStockPages(baseSelect);
  }
  const cutoffIso = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const query = `${baseSelect}&timestamp=gte.${encodeURIComponent(
    cutoffIso
  )}`;
  return supabaseFetchStock(query);
}

document.addEventListener('DOMContentLoaded', () => {
  const yearEl = document.getElementById('current-year');
  if (yearEl) {
    yearEl.textContent = new Date().getFullYear();
  }

  const chartEl = document.getElementById('stock-chart');
  if (!chartEl || typeof echarts === 'undefined') {
    console.warn('ECharts 不可用，无法绘制 China Stock 图表。');
    return;
  }

  const chart = echarts.init(chartEl, null, { renderer: 'canvas' });
  const updatedEl = document.getElementById('stock-updated');
  const rangeLabelEl = document.getElementById('stock-range-label');
  const highlightEl = document.getElementById('stock-highlights');
  const cardsEl = document.getElementById('stock-cards');
  const refreshBtn = document.getElementById('refresh-stock');
  const portfolioTitleEl = document.getElementById('stock-portfolio-title');

  const absoluteToggle = document.getElementById('stock-mode-absolute');
  const percentToggle = document.getElementById('stock-mode-percent');
  const rangeToggles = {
    all: document.getElementById('stock-range-all'),
    '30d': document.getElementById('stock-range-30d'),
    '7d': document.getElementById('stock-range-7d'),
    '72h': document.getElementById('stock-range-72h'),
    '24h': document.getElementById('stock-range-24h')
  };

  const state = {
    chart,
    raw: [],
    timeline: [],
    portfolios: [],
    mode: 'absolute',
    range: '24h'
  };

  const setRangeLabel = (range) => {
    if (rangeLabelEl) {
      rangeLabelEl.textContent = STOCK_RANGE_LABELS[range] || range.toUpperCase();
    }
  };

  let pendingRangeReq = 0;
  const loadRangeData = (range, { force = false } = {}) => {
    if (!force && state.range === range && state.timeline.length) {
      return Promise.resolve();
    }
    pendingRangeReq += 1;
    const requestId = pendingRangeReq;
    if (updatedEl) {
      updatedEl.textContent = '数据加载中…';
    }
    return loadStockIndexData(range)
      .then((rows) => {
        if (requestId !== pendingRangeReq) {
          return;
        }
        const parsed = transformStockRows(rows);
        state.raw = rows;
        state.timeline = parsed.timeline;
        state.portfolios = parsed.portfolios;
        state.range = range;
        renderAll();
      })
      .catch((error) => {
        console.error('加载 stock_index 失败:', error);
        if (requestId !== pendingRangeReq) {
          return;
        }
        if (updatedEl) {
          updatedEl.textContent = `加载失败：${error.message}`;
        }
      });
  };

  const renderAll = () => {
    updatePortfolioTitle(state.portfolios, portfolioTitleEl);
    if (!state.timeline.length) {
      return;
    }
    updateChart(state);
    updateHighlights(state, highlightEl, updatedEl);
    updateCards(state, cardsEl);
    setRangeLabel(state.range);
  };

  const activateRange = (range) => {
    Object.entries(rangeToggles).forEach(([key, el]) => {
      if (el) {
        el.checked = key === range;
      }
    });
    setRangeLabel(range);
    loadRangeData(range);
  };

  absoluteToggle?.addEventListener('change', () => {
    if (absoluteToggle.checked) {
      state.mode = 'absolute';
      updateChart(state);
      updateCards(state, cardsEl);
    }
  });

  percentToggle?.addEventListener('change', () => {
    if (percentToggle.checked) {
      state.mode = 'percent';
      updateChart(state);
      updateCards(state, cardsEl);
    }
  });

  Object.entries(rangeToggles).forEach(([range, input]) => {
    input?.addEventListener('change', () => {
      if (input.checked) {
        activateRange(range);
      }
    });
  });

  refreshBtn?.addEventListener('click', () => {
    setButtonLoading(refreshBtn, true);
    loadRangeData(state.range, { force: true }).finally(() => {
      setButtonLoading(refreshBtn, false);
    });
  });

  window.addEventListener('resize', () => {
    chart.resize();
  });

  setRangeLabel(state.range);
  activateRange(state.range);
});

function transformStockRows(rows) {
  if (!Array.isArray(rows) || !rows.length) {
    return { timeline: [], portfolios: [] };
  }

  const timelineMap = new Map();
  const portfolios = new Set();

  rows.forEach((row) => {
    const time = new Date(row.timestamp);
    const value = parseFloat(normalizeNumberString(row.value));
    if (Number.isNaN(value) || Number.isNaN(time.valueOf())) {
      return;
    }
    const name = row.portfolio || 'UNKNOWN';
    portfolios.add(name);
    const bucketKey = time.toISOString();
    if (!timelineMap.has(bucketKey)) {
      timelineMap.set(bucketKey, {
        timestamp: bucketKey,
        time,
        values: {}
      });
    }
    timelineMap.get(bucketKey).values[name] = value;
  });

  const timeline = Array.from(timelineMap.values()).sort(
    (a, b) => a.time - b.time
  );
  const sortedPortfolios = Array.from(portfolios).sort((a, b) => {
    if (a === 'SSE' && b !== 'SSE') return -1;
    if (b === 'SSE' && a !== 'SSE') return 1;
    return a.localeCompare(b, 'en', { numeric: true });
  });
  return {
    timeline,
    portfolios: sortedPortfolios
  };
}

function updateChart(state) {
  const { chart, timeline, portfolios, mode } = state;
  if (!chart || !timeline.length || !portfolios.length) {
    return;
  }

  const categories = timeline.map((entry) => entry.timestamp);
  const baseValues = {};
  portfolios.forEach((name) => {
    const baseEntry = timeline.find((entry) =>
      Number.isFinite(entry.values[name])
    );
    baseValues[name] = baseEntry ? baseEntry.values[name] : NaN;
  });

  const option = {
    animation: true,
    grid: { top: 32, left: 48, right: 24, bottom: 40 },
    legend: { top: 0, left: 'center' },
    tooltip: {
      trigger: 'axis',
      valueFormatter: (value) => formatStockValue(value, mode)
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: categories,
      axisLabel: {
        formatter: (value) => formatAxisTick(value)
      }
    },
    yAxis: {
      type: 'value',
      axisLabel: {
        formatter: (value) => formatStockValue(value, mode)
      }
    },
    series: portfolios.map((name) => ({
      type: 'line',
      name,
      symbol: 'circle',
      symbolSize: 4,
      smooth: true,
      data: timeline.map((entry) => {
        const rawValue = entry.values[name];
        if (!Number.isFinite(rawValue)) {
          return [entry.timestamp, null];
        }
        if (mode === 'percent') {
          return [entry.timestamp, normalizePercent(rawValue, baseValues[name])];
        }
        return [entry.timestamp, rawValue];
      })
    }))
  };

  chart.setOption(option, true);
}

function updateHighlights(state, highlightEl, updatedEl) {
  if (!highlightEl || !state.timeline.length) {
    return;
  }
  const latest = state.timeline[state.timeline.length - 1];
  if (updatedEl && latest) {
    updatedEl.textContent = `最新数据：${formatDateTime(latest.time)}`;
  }

  const first = state.timeline.find((entry) =>
    Object.values(entry.values).some((value) => Number.isFinite(value))
  );
  const items = [];
  state.portfolios.forEach((name) => {
    const start = first?.values[name];
    const end = latest?.values[name];
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      return;
    }
    const diff = end - start;
    const pct = normalizePercent(end, start);
    const direction = diff >= 0 ? 'success' : 'danger';
    const sign = diff >= 0 ? '+' : '';
    items.push(`
      <li class="d-flex justify-content-between align-items-center py-2 border-bottom border-light-subtle">
        <span class="fw-semibold">${name}</span>
        <span class="text-muted ms-3 text-end">
          <span class="fw-semibold text-body">${end.toFixed(2)}</span>
          <span class="badge bg-${direction}-subtle text-${direction} ms-2">${sign}${diff.toFixed(
            2
          )} | ${sign}${pct.toFixed(2)}%</span>
        </span>
      </li>
    `);
  });
  highlightEl.innerHTML =
    items.join('') +
    `<li class="pt-3 small text-muted">数据点数量：${state.timeline.length}</li>`;
}

function updateCards(state, container) {
  if (!container || !state.timeline.length) {
    return;
  }
  const latest = state.timeline[state.timeline.length - 1];
  const first = state.timeline.find((entry) =>
    Object.values(entry.values).some((value) => Number.isFinite(value))
  );
  const cards = state.portfolios
    .map((name) => {
      const start = first?.values[name];
      const end = latest?.values[name];
      if (!Number.isFinite(end) || !Number.isFinite(start)) {
        return '';
      }
      const pct = normalizePercent(end, start);
      const diff = end - start;
      const diffSign = diff >= 0 ? '+' : '';
      const pctSign = pct >= 0 ? '+' : '';
      const changeClass = diff >= 0 ? 'text-success' : 'text-danger';
      const valueLabel =
        state.mode === 'percent'
          ? `${pctSign}${pct.toFixed(2)}%`
          : end.toFixed(2);
      const secondaryLabel =
        state.mode === 'percent'
          ? `${diffSign}${diff.toFixed(2)}`
          : `${pctSign}${pct.toFixed(2)}%`;
      return `
        <div class="coin-card flex-grow-1">
          <div class="coin-symbol">${name}</div>
          <div class="coin-name text-muted">最新数值</div>
          <div class="coin-price fw-semibold">${valueLabel}</div>
          <div class="coin-change ${changeClass}">${secondaryLabel}</div>
        </div>
      `;
    })
    .filter(Boolean);
  container.innerHTML = cards.join('');
}

function updatePortfolioTitle(portfolios, titleEl) {
  if (!titleEl) {
    return;
  }
  const fallback = titleEl.dataset.defaultText || 'China Stock Portfolios';
  if (!Array.isArray(portfolios) || !portfolios.length) {
    titleEl.textContent = fallback;
    return;
  }
  titleEl.textContent = portfolios.join(' · ');
}

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

function normalizePercent(value, base) {
  if (!Number.isFinite(value) || !Number.isFinite(base) || base === 0) {
    return 0;
  }
  return ((value - base) / base) * 100;
}

function normalizeNumberString(raw) {
  if (!raw) {
    return 'NaN';
  }

  let value = String(raw).replace(/["\s]/g, '');
  if (!value) {
    return 'NaN';
  }
  if (/^\d+(\.\d+)?$/.test(value)) {
    return value;
  }
  if (/^\d+(,\d+)?$/.test(value) && value.includes(',')) {
    return value.replace(',', '.');
  }
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(value)) {
    return value.replace(/,/g, '');
  }
  if (
    value.includes('.') &&
    value.includes(',') &&
    /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(value)
  ) {
    return value.replace(/\./g, '').replace(',', '.');
  }
  return value;
}

function formatStockValue(value, mode) {
  if (!Number.isFinite(value)) {
    return '';
  }
  if (mode === 'percent') {
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
  }
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: value >= 1000 ? 2 : 4,
    maximumFractionDigits: value >= 1000 ? 2 : 4
  }).format(value);
}

function formatDateTime(date) {
  if (!(date instanceof Date)) {
    return '';
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    '0'
  )}-${String(date.getDate()).padStart(2, '0')} ${String(
    date.getHours()
  ).padStart(2, '0')}:${String(date.getMinutes()).padStart(
    2,
    '0'
  )}:${String(date.getSeconds()).padStart(2, '0')}`;
}

function formatAxisTick(value) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return value;
  }
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')} ${String(date.getHours()).padStart(
    2,
    '0'
  )}:${String(date.getMinutes()).padStart(2, '0')}`;
}
