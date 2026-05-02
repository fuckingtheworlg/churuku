const { request } = require('../../../utils/request');

function formatDate(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
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
      request({ url: '/mini/stock-record', data: { keyword: '', pageSize: 100 } }),
    ]);
    this.setData({
      item,
      records: res.list
        .filter((record) => record.itemId === Number(this.data.id))
        .map((record) => ({ ...record, occurredAtText: formatDate(record.occurredAt) })),
    });
  },
});
