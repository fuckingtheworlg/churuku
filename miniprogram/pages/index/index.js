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
  async scanItem() {
    try {
      const res = await wx.scanCode({ scanType: ['qrCode'], onlyFromCamera: false });
      const raw = ((res && res.result) || '').trim();
      const unitMatch = raw.match(/unit:(\d+)/i);
      if (unitMatch) {
        wx.navigateTo({ url: `/pages/unit/detail/index?id=${unitMatch[1]}` });
        return;
      }
      const match = raw.match(/(\d+)\s*$/);
      const id = match ? match[1] : '';
      if (!id) {
        wx.showToast({ title: '二维码格式无法识别', icon: 'none' });
        return;
      }
      wx.navigateTo({ url: `/pages/item/detail/index?id=${id}` });
    } catch (error) {
      // user cancelled scan
    }
  },
});
