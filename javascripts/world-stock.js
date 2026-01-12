const WORLD_SUPABASE_URL = '';
const WORLD_SUPABASE_ANON_KEY = '';

const ETF_LIST = [
  { symbol: 'VDY.TO', label: 'Canada High Dividend Equity' },
  { symbol: 'XBM.TO', label: 'Canada Base Metals & Mining' },
  { symbol: 'BIP.UN.TO', label: 'Global Infrastructure Assets' },
  { symbol: 'ZQQ.TO', label: 'Nasdaq 100' }
];

const NEWS_EMPTY_STATE = [
  {
    title: '暂无新闻，等待 Supabase 写入数据。',
    source: 'System',
    ts: null
  }
];

function canUseSupabase() {
  return WORLD_SUPABASE_URL && WORLD_SUPABASE_ANON_KEY;
}

async function supabaseFetchWorld(path, fetchOptions = {}) {
  const { headers: extraHeaders = {}, ...restOptions } = fetchOptions;
  const res = await fetch(`${WORLD_SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: WORLD_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${WORLD_SUPABASE_ANON_KEY}`,
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

async function loadEtfKline(symbol) {
  if (!canUseSupabase()) {
    return [];
  }
  const query =
    `world_etf_kline?select=ts,open,high,low,close&symbol=eq.${encodeURIComponent(
      symbol
    )}&order=ts`;
  return supabaseFetchWorld(query);
}

async function loadVixSeries() {
  if (!canUseSupabase()) {
    return [];
  }
  const query = 'world_vix?select=ts,value&order=ts';
  return supabaseFetchWorld(query);
}

async function loadNews() {
  if (!canUseSupabase()) {
    return [];
  }
  const query = 'world_news?select=title,source,ts,link&order=ts.desc&limit=8';
  return supabaseFetchWorld(query);
}

function seedFromString(input) {
  return Array.from(input).reduce((acc, char) => acc + char.charCodeAt(0), 0);
}

function buildMockKline(symbol, days = 60) {
  const baseMap = {
    'VDY.TO': 45,
    'XBM.TO': 30,
    'BIP.UN.TO': 40,
    'ZQQ.TO': 85
  };
  const base = baseMap[symbol] || 100;
  const seed = seedFromString(symbol) % 97;
  const series = [];
  let price = base;

  for (let i = days; i >= 0; i -= 1) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const drift = (Math.sin((i + seed) / 6) + 1) * 0.6;
    const open = price + drift;
    const close = open + (Math.cos((i + seed) / 7) - 0.2) * 0.9;
    const high = Math.max(open, close) + 0.8;
    const low = Math.min(open, close) - 0.8;
    series.push({
      ts: date.toISOString(),
      open,
      high,
      low,
      close
    });
    price = close;
  }

  return series;
}

function buildMockVix(days = 60) {
  const series = [];
  for (let i = days; i >= 0; i -= 1) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const value = 16 + Math.sin(i / 5) * 3 + (i % 7) * 0.2;
    series.push({ ts: date.toISOString(), value });
  }
  return series;
}

function formatDateLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return '';
  }
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return '';
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    '0'
  )}-${String(date.getDate()).padStart(2, '0')} ${String(
    date.getHours()
  ).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function buildKlineOption(symbol, rawRows) {
  const rows = rawRows || [];
  const categories = rows.map((row) => row.ts);
  const data = rows.map((row) => [
    Number(row.open),
    Number(row.close),
    Number(row.low),
    Number(row.high)
  ]);

  return {
    animation: true,
    grid: { top: 16, left: 52, right: 16, bottom: 36 },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' }
    },
    xAxis: {
      type: 'category',
      data: categories,
      axisLabel: { formatter: formatDateLabel },
      axisLine: { lineStyle: { color: '#cbd5e1' } }
    },
    yAxis: {
      scale: true,
      axisLabel: {
        formatter: (value) => Number(value).toFixed(2)
      },
      splitLine: { lineStyle: { color: '#eef2f7' } }
    },
    series: [
      {
        name: symbol,
        type: 'candlestick',
        data,
        itemStyle: {
          color: '#1f2933',
          color0: '#f59f00',
          borderColor: '#1f2933',
          borderColor0: '#f59f00'
        }
      }
    ]
  };
}

function buildVixOption(rows) {
  const categories = rows.map((row) => row.ts);
  const data = rows.map((row) => row.value);
  return {
    animation: true,
    grid: { top: 16, left: 52, right: 16, bottom: 36 },
    tooltip: {
      trigger: 'axis'
    },
    xAxis: {
      type: 'category',
      data: categories,
      axisLabel: { formatter: formatDateLabel },
      axisLine: { lineStyle: { color: '#cbd5e1' } }
    },
    yAxis: {
      type: 'value',
      axisLabel: {
        formatter: (value) => value.toFixed(1)
      },
      splitLine: { lineStyle: { color: '#eef2f7' } }
    },
    series: [
      {
        name: 'VIX',
        type: 'line',
        smooth: true,
        symbol: 'none',
        lineStyle: { width: 2, color: '#0f172a' },
        areaStyle: { color: 'rgba(15, 23, 42, 0.08)' },
        data
      }
    ]
  };
}

function renderNews(listEl, newsItems) {
  if (!listEl) {
    return;
  }
  const items = Array.isArray(newsItems) && newsItems.length ? newsItems : NEWS_EMPTY_STATE;
  listEl.innerHTML = items
    .map((item) => {
      const timeText = item.ts ? formatDateTime(item.ts) : '等待更新';
      const title = item.title || '未命名事件';
      const source = item.source || '未知来源';
      const link = item.link;
      const titleNode = link
        ? `<a href="${link}" target="_blank" rel="noopener">${title}</a>`
        : title;
      return `
        <li class="news-item">
          <div class="news-title">${titleNode}</div>
          <div class="news-meta">${source} · ${timeText}</div>
        </li>
      `;
    })
    .join('');
}

function setUpdatedText(el, text) {
  if (el) {
    el.textContent = text;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const yearEl = document.getElementById('current-year');
  if (yearEl) {
    yearEl.textContent = new Date().getFullYear();
  }

  if (typeof echarts === 'undefined') {
    console.warn('ECharts 不可用，World Stock 图表无法渲染。');
    return;
  }

  const vixChartEl = document.getElementById('vix-chart');
  const vixUpdatedEl = document.getElementById('vix-updated');
  const newsListEl = document.getElementById('news-list');
  const refreshVixBtn = document.getElementById('refresh-vix');
  const refreshNewsBtn = document.getElementById('refresh-news');
  const refreshEtfBtn = document.getElementById('refresh-etf');

  const charts = new Map();

  const initCharts = () => {
    ETF_LIST.forEach(({ symbol }) => {
      const el = document.querySelector(`.kline-chart[data-symbol="${symbol}"]`);
      if (!el) {
        return;
      }
      charts.set(symbol, echarts.init(el, null, { renderer: 'canvas' }));
    });
    if (vixChartEl) {
      charts.set('VIX', echarts.init(vixChartEl, null, { renderer: 'canvas' }));
    }
  };

  const loadVix = () => {
    return loadVixSeries()
      .then((rows) => {
        const data = rows.length ? rows : buildMockVix();
        const chart = charts.get('VIX');
        if (chart) {
          chart.setOption(buildVixOption(data), true);
        }
        const latest = data[data.length - 1];
        setUpdatedText(
          vixUpdatedEl,
          latest ? `最新更新：${formatDateTime(latest.ts)}` : '暂无数据'
        );
      })
      .catch((error) => {
        console.error('加载 VIX 失败:', error);
        setUpdatedText(vixUpdatedEl, `加载失败：${error.message}`);
      });
  };

  const loadEtf = () => {
    const tasks = ETF_LIST.map(({ symbol }) =>
      loadEtfKline(symbol)
        .then((rows) => {
          const data = rows.length ? rows : buildMockKline(symbol);
          const chart = charts.get(symbol);
          if (chart) {
            chart.setOption(buildKlineOption(symbol, data), true);
          }
        })
        .catch((error) => {
          console.error(`加载 ${symbol} 失败:`, error);
        })
    );
    return Promise.all(tasks);
  };

  const loadNewsFeed = () => {
    return loadNews()
      .then((rows) => {
        renderNews(newsListEl, rows);
      })
      .catch((error) => {
        console.error('加载新闻失败:', error);
        renderNews(newsListEl, []);
      });
  };

  initCharts();
  loadVix();
  loadEtf();
  loadNewsFeed();

  refreshVixBtn?.addEventListener('click', () => {
    loadVix();
  });

  refreshEtfBtn?.addEventListener('click', () => {
    loadEtf();
  });

  refreshNewsBtn?.addEventListener('click', () => {
    loadNewsFeed();
  });

  window.addEventListener('resize', () => {
    charts.forEach((chart) => chart.resize());
  });
});
