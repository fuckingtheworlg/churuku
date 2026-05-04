const { request, upload } = require('../../../utils/request');

function today() {
  const date = new Date();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${m}-${d}`;
}

Page({
  data: {
    type: 'in',
    items: [],
    itemNames: [],
    projectName: '',
    lines: [{ itemIndex: -1, quantity: '' }],
    location: {},
    photos: [],
    date: today(),
    note: '',
    loading: false,
  },
  onLoad(options) {
    this.setData({ type: options.type || 'in' });
    wx.setNavigationBarTitle({ title: this.data.type === 'in' ? '入库' : '出库' });
    this.loadItems();
  },
  async loadItems() {
    const res = await request({ url: '/mini/item', data: { pageSize: 200 } });
    this.setData({ items: res.list, itemNames: res.list.map((item) => `${item.name}（${item.quantity}${item.unit}）`) });
  },
  onProjectName(e) {
    this.setData({ projectName: e.detail.value });
  },
  onLineItemChange(e) {
    const index = Number(e.currentTarget.dataset.index);
    const lines = this.data.lines.slice();
    lines[index].itemIndex = Number(e.detail.value);
    this.setData({ lines });
  },
  onLineQuantity(e) {
    const index = Number(e.currentTarget.dataset.index);
    const lines = this.data.lines.slice();
    lines[index].quantity = e.detail.value;
    this.setData({ lines });
  },
  addLine() {
    this.setData({ lines: [...this.data.lines, { itemIndex: -1, quantity: '' }] });
  },
  removeLine(e) {
    const index = Number(e.currentTarget.dataset.index);
    const lines = this.data.lines.filter((_, i) => i !== index);
    this.setData({ lines: lines.length ? lines : [{ itemIndex: -1, quantity: '' }] });
  },
  onDate(e) {
    this.setData({ date: e.detail.value });
  },
  onNote(e) {
    this.setData({ note: e.detail.value });
  },
  async chooseLocation() {
    try {
      const location = await wx.chooseLocation();
      this.setData({ location });
    } catch (error) {
      wx.showToast({ title: '未选择位置', icon: 'none' });
    }
  },
  async choosePhotos() {
    const res = await wx.chooseMedia({
      count: 6,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
    });
    this.setData({ photos: res.tempFiles.map((file) => file.tempFilePath) });
  },
  async submit() {
    const projectName = this.data.projectName.trim();
    const orderItems = this.data.lines.map((line) => ({
      item: this.data.items[line.itemIndex],
      quantity: Number(line.quantity),
    }));
    if (!projectName) {
      wx.showToast({ title: '请填写项目名称', icon: 'none' });
      return;
    }
    if (orderItems.some((line) => !line.item || !line.quantity) || !this.data.location.latitude) {
      wx.showToast({ title: '请选择物品、数量和位置', icon: 'none' });
      return;
    }
    this.setData({ loading: true });
    try {
      wx.showLoading({ title: '上传附件' });
      const photoUrls = [];
      for (const path of this.data.photos) {
        photoUrls.push(await upload(path));
      }
      const signaturePath = await this.selectComponent('#signature').exportImage();
      const signatureUrl = signaturePath ? await upload(signaturePath) : '';
      wx.showLoading({ title: '提交中' });
      await request({
        url: '/stock-record',
        method: 'POST',
        data: {
          type: this.data.type,
          projectName,
          items: orderItems.map((line) => ({ itemId: line.item.id, quantity: line.quantity })),
          latitude: this.data.location.latitude,
          longitude: this.data.location.longitude,
          address: this.data.location.address,
          poiName: this.data.location.name,
          photos: photoUrls,
          signatureUrl,
          occurredAt: `${this.data.date}T00:00:00.000Z`,
          note: this.data.note,
        },
      });
      wx.hideLoading();
      wx.showToast({ title: '提交成功' });
      setTimeout(() => wx.switchTab({ url: '/pages/index/index' }), 700);
    } catch (error) {
      wx.hideLoading();
      wx.showToast({ title: error.message || '提交失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },
});
