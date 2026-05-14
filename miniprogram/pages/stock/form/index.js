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
    let res;
    try {
      res = await wx.chooseMedia({
        count: 6,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        sizeType: ['compressed'],
      });
    } catch (error) {
      return;
    }
    const files = Array.isArray(res && res.tempFiles) ? res.tempFiles : [];
    if (!files.length) return;
    wx.showLoading({ title: '处理图片' });
    try {
      const photos = [];
      for (const file of files) {
        photos.push(await this.compressIfNeeded(file));
      }
      this.setData({ photos });
    } catch (error) {
      wx.showToast({ title: error.message || '图片处理失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },
  async compressIfNeeded(file) {
    const size = Number(file.size || 0);
    const path = file.tempFilePath;
    if (!size || size <= 800 * 1024) return path;
    return new Promise((resolve) => {
      wx.compressImage({
        src: path,
        quality: 70,
        success: (res) => resolve(res.tempFilePath || path),
        fail: () => resolve(path),
      });
    });
  },
  async submit() {
    const projectName = (this.data.projectName || '').trim();
    if (!projectName) {
      wx.showToast({ title: '请填写项目名称', icon: 'none' });
      return;
    }
    const orderItems = this.data.lines.map((line) => ({
      item: this.data.items[line.itemIndex],
      quantity: Number(line.quantity),
    }));
    if (!orderItems.length || orderItems.some((line) => !line.item)) {
      wx.showToast({ title: '请为每一行选择物品', icon: 'none' });
      return;
    }
    if (orderItems.some((line) => !Number.isFinite(line.quantity) || line.quantity <= 0)) {
      wx.showToast({ title: '请填写大于 0 的数量', icon: 'none' });
      return;
    }
    if (!this.data.location || !this.data.location.latitude) {
      wx.showToast({ title: '请选择当前位置', icon: 'none' });
      return;
    }
    if (!this.data.photos || !this.data.photos.length) {
      wx.showToast({ title: '请至少拍 1 张照片', icon: 'none' });
      return;
    }
    const signatureComponent = this.selectComponent('#signature');
    if (!signatureComponent || !signatureComponent.data || !signatureComponent.data.hasSign) {
      wx.showToast({ title: '请先签字确认', icon: 'none' });
      return;
    }
    if (!this.data.date) {
      wx.showToast({ title: '请选择日期', icon: 'none' });
      return;
    }
    this.setData({ loading: true });
    try {
      const total = this.data.photos.length;
      const photoUrls = [];
      for (let i = 0; i < total; i += 1) {
        wx.showLoading({ title: `上传图片 ${i + 1}/${total}`, mask: true });
        try {
          photoUrls.push(await upload(this.data.photos[i]));
        } catch (error) {
          wx.hideLoading();
          wx.showModal({
            title: `第 ${i + 1} 张图片上传失败`,
            content: error.message || '上传失败，请重试',
            showCancel: false,
          });
          this.setData({ loading: false });
          return;
        }
      }
      wx.showLoading({ title: '上传签字', mask: true });
      const signaturePath = await signatureComponent.exportImage();
      if (!signaturePath) {
        wx.hideLoading();
        wx.showToast({ title: '签字图片获取失败，请重新签字', icon: 'none' });
        this.setData({ loading: false });
        return;
      }
      let signatureUrl = '';
      try {
        signatureUrl = await upload(signaturePath);
      } catch (error) {
        wx.hideLoading();
        wx.showModal({
          title: '签字上传失败',
          content: error.message || '签字上传失败，请重试',
          showCancel: false,
        });
        this.setData({ loading: false });
        return;
      }
      wx.showLoading({ title: '提交中', mask: true });
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
