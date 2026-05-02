const { request } = require('../../utils/request');

Page({
  data: {
    items: [],
    categories: [],
    keyword: '',
    categoryId: '',
  },
  onShow() {
    this.loadAll();
  },
  async loadAll() {
    await Promise.all([this.loadCategories(), this.load()]);
  },
  async loadCategories() {
    const categories = await request({ url: '/mini/item-category' });
    this.setData({ categories });
  },
  async load() {
    const res = await request({
      url: '/mini/item',
      data: { keyword: this.data.keyword, categoryId: this.data.categoryId, pageSize: 100 },
    });
    this.setData({ items: res.list });
  },
  onKeyword(e) {
    this.setData({ keyword: e.detail.value });
  },
  selectCategory(e) {
    this.setData({ categoryId: e.currentTarget.dataset.id || '' });
    this.load();
  },
  goDetail(e) {
    wx.navigateTo({ url: `/pages/item/detail/index?id=${e.currentTarget.dataset.id}` });
  },
  goStock(e) {
    wx.navigateTo({ url: `/pages/stock/form/index?type=${e.currentTarget.dataset.type}` });
  },
});
