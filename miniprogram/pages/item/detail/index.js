const { request, asset } = require('../../../utils/request');

function formatDate(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatMinutes(total) {
  const minutes = Math.max(0, Math.round(Number(total) || 0));
  if (!minutes) return '0 分钟';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} 分钟`;
  if (!m) return `${h} 小时`;
  return `${h} 小时 ${m} 分钟`;
}

function presentRecord(record, itemId) {
  const line = (record.items || []).find((item) => item.itemId === itemId) || {};
  const detailItem = line.item || record.item || {};
  const photoUrls = (record.photos || []).map(asset);
  const signatureUrl = asset(record.signatureUrl);
  return {
    ...record,
    displayQuantity: line.quantity || record.quantity,
    displayUnit: detailItem.unit || '件',
    photoUrls,
    signatureUrl,
    previewUrls: signatureUrl ? [...photoUrls, signatureUrl] : photoUrls,
    occurredAtText: formatDate(record.occurredAt),
  };
}

function presentUsage(summary) {
  if (!summary) {
    return { ongoing: null, ongoingText: '', totalText: '0 分钟', recent: [] };
  }
  const ongoing = summary.ongoing
    ? {
        operatorName: summary.ongoing.operatorName,
        startedAtText: formatDateTime(summary.ongoing.startedAt),
        durationText: formatMinutes(summary.ongoing.durationMinutes),
      }
    : null;
  return {
    ongoing,
    totalText: formatMinutes(summary.totalMinutes),
    recent: (summary.recent || []).map((row) => ({
      id: row.id,
      operatorName: row.operatorName,
      startedAtText: formatDateTime(row.startedAt),
      endedAtText: row.endedAt ? formatDateTime(row.endedAt) : '使用中',
      durationText: row.endedAt ? formatMinutes(row.durationMinutes) : '',
    })),
  };
}

Page({
  data: {
    id: '',
    item: null,
    records: [],
    usage: { ongoing: null, totalText: '0 分钟', recent: [] },
    usageLoading: false,
  },
  onLoad(options) {
    this.setData({ id: options.id });
    this.load();
  },
  async load() {
    const itemId = Number(this.data.id);
    const [item, res, usage] = await Promise.all([
      request({ url: `/mini/item/${this.data.id}` }),
      request({ url: '/mini/stock-record', data: { itemId, pageSize: 100 } }),
      request({ url: `/mini/item/${this.data.id}/usage` }).catch(() => null),
    ]);
    this.setData({
      item,
      records: res.list.map((record) => presentRecord(record, itemId)),
      usage: presentUsage(usage),
    });
  },
  async startUsage() {
    if (this.data.usageLoading) return;
    this.setData({ usageLoading: true });
    try {
      const usage = await request({
        url: '/mini/usage/start',
        method: 'POST',
        data: { itemId: Number(this.data.id) },
      });
      this.setData({ usage: presentUsage(usage) });
      wx.showToast({ title: '已开始使用' });
    } catch (error) {
      wx.showToast({ title: error.message || '开始失败', icon: 'none' });
    } finally {
      this.setData({ usageLoading: false });
    }
  },
  async endUsage() {
    if (this.data.usageLoading) return;
    this.setData({ usageLoading: true });
    try {
      const usage = await request({
        url: '/mini/usage/end',
        method: 'POST',
        data: { itemId: Number(this.data.id) },
      });
      this.setData({ usage: presentUsage(usage) });
      wx.showToast({ title: '已结束使用' });
    } catch (error) {
      wx.showToast({ title: error.message || '结束失败', icon: 'none' });
    } finally {
      this.setData({ usageLoading: false });
    }
  },
  previewImage(event) {
    const { index, current } = event.currentTarget.dataset;
    const record = this.data.records[index];
    if (!record || !record.previewUrls.length) return;
    wx.previewImage({
      current,
      urls: record.previewUrls,
    });
  },
});
