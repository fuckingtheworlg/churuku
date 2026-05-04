const { request, asset } = require('../../utils/request');

function formatDate(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function presentRecord(record) {
  const item = record.item || {};
  const photoUrls = (record.photos || []).map(asset);
  const signatureUrl = asset(record.signatureUrl);
  return {
    ...record,
    itemName: record.itemSummary || item.name || '未知物品',
    unit: item.unit || '件',
    typeText: record.type === 'in' ? '入库' : '出库',
    photoUrls,
    signatureUrl,
    previewUrls: signatureUrl ? [...photoUrls, signatureUrl] : photoUrls,
    occurredAtText: formatDate(record.occurredAt),
  };
}

Page({
  data: {
    user: {},
    records: [],
  },
  onShow() {
    this.load();
  },
  async load() {
    try {
      const [me, records] = await Promise.all([
        request({ url: '/auth/me' }),
        request({ url: '/mini/stock-record', data: { mine: true, pageSize: 50 } }),
      ]);
      this.setData({
        user: me.user || wx.getStorageSync('user') || {},
        records: (records.list || []).map(presentRecord),
      });
    } catch (error) {
      this.setData({ user: wx.getStorageSync('user') || {}, records: [] });
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
  logout() {
    wx.removeStorageSync('token');
    wx.removeStorageSync('user');
    wx.reLaunch({ url: '/pages/login/index' });
  },
});
