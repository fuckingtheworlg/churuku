const { request, asset } = require('../../../utils/request');

function formatDate(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function presentRecord(record) {
  const photoUrls = (record.photos || []).map(asset);
  const signatureUrl = asset(record.signatureUrl);
  return {
    ...record,
    photoUrls,
    signatureUrl,
    previewUrls: signatureUrl ? [...photoUrls, signatureUrl] : photoUrls,
    occurredAtText: formatDate(record.occurredAt),
  };
}

Page({
  data: {
    id: '',
    item: null,
    records: [],
  },
  onLoad(options) {
    this.setData({ id: options.id });
    this.load();
  },
  async load() {
    const [item, res] = await Promise.all([
      request({ url: `/mini/item/${this.data.id}` }),
      request({ url: '/mini/stock-record', data: { itemId: Number(this.data.id), pageSize: 100 } }),
    ]);
    this.setData({
      item,
      records: res.list.map(presentRecord),
    });
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
