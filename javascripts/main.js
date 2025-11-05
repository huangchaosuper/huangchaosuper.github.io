document.addEventListener('DOMContentLoaded', () => {
  const yearEl = document.getElementById('current-year');
  if (yearEl) {
    yearEl.textContent = new Date().getFullYear();
  }

  const tickerEl = document.getElementById('coin-ticker');
  const highlightsEl = document.getElementById('index-highlights');
  const updatedEl = document.getElementById('chart-updated');
  const dictUpdateEl = document.getElementById('dict-update');
  const percentToggle = document.getElementById('mode-percent');
  const absoluteToggle = document.getElementById('mode-absolute');
  const chartContainer = document.getElementById('index-chart');

  if (!chartContainer || typeof echarts === 'undefined') {
    console.warn('ECharts not available, chart will not render.');
    return;
  }

  fetch('./data/coin.csv', { cache: 'no-store' })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`无法加载币种数据（${response.status}）`);
      }
      return response.text();
    })
    .then((text) => {
      const coins = parseCoinCsv(text);
      if (!coins.length) {
        throw new Error('币种数据为空');
      }
      renderTicker(coins, tickerEl);
    })
    .catch((error) => {
      console.error(error);
      if (tickerEl) {
        tickerEl.innerHTML = `<div class="text-danger small">${error.message}</div>`;
      }
    });

  fetch('./data/index.csv', { cache: 'no-store' })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`无法加载指数数据（${response.status}）`);
      }
      return response.text();
    })
    .then((text) => {
      const parsed = parseCsv(text);
      if (!parsed.length) {
        throw new Error('指数数据为空');
      }
      const chart = echarts.init(chartContainer, null, { renderer: 'canvas' });
      const state = {
        mode: 'absolute',
        data: parsed,
        chart
      };

      updateChart(state);
      updateHighlights(state, highlightsEl, updatedEl);

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
    })
    .catch((error) => {
      console.error(error);
      if (updatedEl) {
        updatedEl.textContent = `加载失败：${error.message}`;
      }
    });

  fetch('./data/dict.csv', { cache: 'no-store' })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`无法加载字典数据（${response.status}）`);
      }
      return response.text();
    })
    .then((text) => {
      const dict = parseDictCsv(text);
      if (dictUpdateEl) {
        const timestamp = dict.update_timestamp;
        dictUpdateEl.textContent = timestamp
          ? `数据更新时间：${timestamp}`
          : '数据更新时间：-';
      }
    })
    .catch((error) => {
      console.error(error);
      if (dictUpdateEl) {
        dictUpdateEl.textContent = `数据更新时间加载失败：${error.message}`;
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

  const currencyFormatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2
  });

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
      <div class="coin-change ${changeClass}">${changePrefix}${coin.change.toFixed(2)}%</div>
    `;
    tickerEl.appendChild(card);
  });
}

function parseCoinCsv(input) {
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
      const change = parseFloat(normalizeNumberString(segments[segments.length - 1]));
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
  return input
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .filter(Boolean)
    .map((line) => {
      const [cmc20, cmc100, indexValue, timestamp] = line.split(',');
      const isoLike = timestamp.replace(' ', 'T');
      return {
        cmc20: parseFloat(cmc20),
        cmc100: parseFloat(cmc100),
        index: parseFloat(indexValue),
        timestamp,
        time: new Date(isoLike)
      };
    })
    .filter((entry) => Number.isFinite(entry.cmc20) && Number.isFinite(entry.cmc100) && Number.isFinite(entry.index) && entry.time instanceof Date && !Number.isNaN(entry.time.valueOf()));
}

function updateChart(state) {
  const { chart, data, mode } = state;
  if (!chart || !data.length) {
    return;
  }

  const colors = ['#4c6ef5', '#fa8c16', '#2fb344'];
  const base = data[0];

  const series = [
    {
      key: 'cmc20',
      name: 'CMC20',
      color: colors[0]
    },
    {
      key: 'cmc100',
      name: 'CMC100',
      color: colors[1]
    },
    {
      key: 'index',
      name: 'Custom Index',
      color: colors[2]
    }
  ].map((serie) => ({
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
      const value =
        mode === 'percent'
          ? normalizePercent(raw, base[serie.key])
          : raw;
      return [entry.time, Number.isFinite(value) ? value : null];
    })
  }));

  const option = {
    color: colors,
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
      }
    },
    series
  };

  chart.setOption(option, true);
}

function updateHighlights(state, highlightsEl, updatedEl) {
  const { data } = state;
  if (!data || !data.length) {
    return;
  }

  const first = data[0];
  const last = data[data.length - 1];

  if (updatedEl) {
    const formatter = new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    updatedEl.textContent = `最新更新时间：${formatter.format(last.time)}`;
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
          <span class="badge rounded-pill bg-${direction === 'positive' ? 'success' : 'danger'} bg-opacity-10 text-${direction === 'positive' ? 'success' : 'danger'}">${sign}${pct.toFixed(2)}%</span>
        </span>
      </li>
    `;
  };

  highlightsEl.innerHTML = [
    makeListItem('CMC20', last.cmc20, first.cmc20),
    makeListItem('CMC100', last.cmc100, first.cmc100),
    makeListItem('Custom Index', last.index, first.index),
    `<li class="pt-3 small text-muted">数据点数量：${data.length}</li>`
  ].join('');
}

function normalizePercent(value, base) {
  if (base === 0 || !Number.isFinite(base)) {
    return 0;
  }
  return ((value - base) / base) * 100;
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

function parseDictCsv(text) {
  const rows = text
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .filter(Boolean);
  return rows.reduce((acc, row) => {
    const [key, ...rest] = row.split(',');
    if (!key) {
      return acc;
    }
    const value = rest.join(',').trim();
    acc[key.trim()] = value;
    return acc;
  }, {});
}

function normalizeNumberString(raw) {
  if (!raw) {
    return 'NaN';
  }
  let value = String(raw).replace(/["\s]/g, '');
  if (!value) {
    return 'NaN';
  }

  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(value)) {
    // US thousand separators
    value = value.replace(/,/g, '');
    return value;
  }

  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(value)) {
    // European format e.g. 1.234.567,89
    value = value.replace(/\./g, '').replace(',', '.');
    return value;
  }

  if (/^\d+(,\d+)?$/.test(value) && value.includes(',')) {
    // Decimal comma without thousands e.g. 101715,30
    value = value.replace(',', '.');
    return value;
  }

  return value;
}
