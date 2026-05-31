const { request, upload } = require('../../../utils/request');

function today() {
  const date = new Date();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${m}-${d}`;
}

function emptyLine() {
  return { itemIndex: -1, quantity: '', trackIndividually: false, units: [], selectedUnitIds: [] };
}

Page({
  data: {
    type: 'in',
    items: [],
    itemNames: [],
    projectName: '',
    lines: [emptyLine()],
    // 入库归还
    returnMode: false,
    returnableOrders: [],
    returnLabels: [],
    returnIndex: -1,
    location: {},
    photos: [],
    date: today(),
    note: '',
    loading: false,
  },
  onLoad(options) {
    const type = options.type || 'in';
    this.setData({ type, returnMode: type === 'in' });
    wx.setNavigationBarTitle({ title: type === 'in' ? '入库' : '出库' });
    this.loadItems();
    if (type === 'in') this.loadReturnable();
  },
  async loadItems() {
    const res = await request({ url: '/mini/item', data: { pageSize: 200 } });
    this.setData({
      items: res.list,
      itemNames: res.list.map((item) => `${item.name}（库存 ${item.quantity}${item.unit}）`),
    });
  },
  async loadReturnable() {
    try {
      const list = await request({ url: '/mini/returnable-orders' });
      this.setData({
        returnableOrders: list,
        returnLabels: list.map(
          (o) => `${o.projectName || '出库单'} · ${o.itemSummary || ''}${o.unitSummary ? '（' + o.unitSummary + '）' : ''}`,
        ),
      });
    } catch (error) {
      this.setData({ returnableOrders: [], returnLabels: [] });
    }
  },
  switchReturnMode(e) {
    this.setData({ returnMode: !!e.detail.value });
  },
  onReturnPick(e) {
    this.setData({ returnIndex: Number(e.detail.value) });
  },
  onProjectName(e) {
    this.setData({ projectName: e.detail.value });
  },
  async onLineItemChange(e) {
    const index = Number(e.currentTarget.dataset.index);
    const lines = this.data.lines.slice();
    const itemIndex = Number(e.detail.value);
    const item = this.data.items[itemIndex];
    lines[index].itemIndex = itemIndex;
    lines[index].selectedUnitIds = [];
    lines[index].quantity = '';
    lines[index].trackIndividually = !!(item && item.trackIndividually);
    lines[index].units = [];
    this.setData({ lines });
    if (item && item.trackIndividually && this.data.type === 'out') {
      try {
        const units = await request({ url: `/mini/item/${item.id}/units` });
        const available = (units || [])
          .filter((u) => u.status === 'in_stock' && !u.inUse)
          .map((u) => ({ id: u.id, code: u.code }));
        const next = this.data.lines.slice();
        next[index].units = available;
        this.setData({ lines: next });
      } catch (error) {
        // ignore
      }
    }
  },
  onLineUnitsChange(e) {
    const index = Number(e.currentTarget.dataset.index);
    const lines = this.data.lines.slice();
    lines[index].selectedUnitIds = (e.detail.value || []).map(Number);
    this.setData({ lines });
  },
  onLineQuantity(e) {
    const index = Number(e.currentTarget.dataset.index);
    const lines = this.data.lines.slice();
    lines[index].quantity = e.detail.value;
    this.setData({ lines });
  },
  addLine() {
    this.setData({ lines: [...this.data.lines, emptyLine()] });
  },
  removeLine(e) {
    const index = Number(e.currentTarget.dataset.index);
    const lines = this.data.lines.filter((_, i) => i !== index);
    this.setData({ lines: lines.length ? lines : [emptyLine()] });
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
  buildPayload() {
    // 返回 { ok, payload, msg }
    const isReturn = this.data.type === 'in' && this.data.returnMode;
    if (isReturn) {
      const order = this.data.returnableOrders[this.data.returnIndex];
      if (!order) return { ok: false, msg: '请选择要归还的出库单' };
      return {
        ok: true,
        payload: {
          type: 'in',
          relatedOrderId: order.id,
          projectName: order.projectName || '归还入库',
        },
      };
    }
    const projectName = (this.data.projectName || '').trim();
    if (!projectName) return { ok: false, msg: '请填写项目名称' };
    const orderItems = [];
    for (const line of this.data.lines) {
      const item = this.data.items[line.itemIndex];
      if (!item) return { ok: false, msg: '请为每一行选择物品' };
      if (this.data.type === 'out' && item.trackIndividually) {
        if (!line.selectedUnitIds.length) {
          return { ok: false, msg: `${item.name} 需要勾选具体设备（单台）` };
        }
        orderItems.push({ itemId: item.id, quantity: line.selectedUnitIds.length, unitIds: line.selectedUnitIds });
      } else {
        const quantity = Number(line.quantity);
        if (!Number.isFinite(quantity) || quantity <= 0) {
          return { ok: false, msg: '请填写大于 0 的数量' };
        }
        orderItems.push({ itemId: item.id, quantity });
      }
    }
    return { ok: true, payload: { type: this.data.type, projectName, items: orderItems } };
  },
  async submit() {
    const built = this.buildPayload();
    if (!built.ok) {
      wx.showToast({ title: built.msg, icon: 'none' });
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
          wx.showModal({ title: `第 ${i + 1} 张图片上传失败`, content: error.message || '上传失败，请重试', showCancel: false });
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
        wx.showModal({ title: '签字上传失败', content: error.message || '签字上传失败，请重试', showCancel: false });
        this.setData({ loading: false });
        return;
      }
      wx.showLoading({ title: '提交中', mask: true });
      await request({
        url: '/stock-record',
        method: 'POST',
        data: Object.assign({}, built.payload, {
          latitude: this.data.location.latitude,
          longitude: this.data.location.longitude,
          address: this.data.location.address,
          poiName: this.data.location.name,
          photos: photoUrls,
          signatureUrl,
          occurredAt: `${this.data.date}T00:00:00.000Z`,
          note: this.data.note,
        }),
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
