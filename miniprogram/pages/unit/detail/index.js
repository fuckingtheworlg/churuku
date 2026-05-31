const { request } = require('../../../utils/request');

function formatMinutes(total) {
  const minutes = Math.max(0, Math.round(Number(total) || 0));
  if (!minutes) return '0 分钟';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} 分钟`;
  if (!m) return `${h} 小时`;
  return `${h} 小时 ${m} 分钟`;
}

function statusText(status) {
  if (status === 'in_stock') return '在库可用';
  if (status === 'out') return '已出库（在外）';
  if (status === 'retired') return '已到期/停用';
  return status || '-';
}

Page({
  data: {
    id: '',
    item: null,
    unit: null,
    statusText: '',
    accumulatedText: '0 分钟',
    ongoingText: '',
    loading: false,
  },
  onLoad(options) {
    this.setData({ id: options.id });
    this.load();
  },
  async load() {
    try {
      const res = await request({ url: `/mini/unit/${this.data.id}` });
      const unit = res.unit || null;
      this.setData({
        item: res.item || null,
        unit,
        statusText: unit ? statusText(unit.status) : '-',
        accumulatedText: formatMinutes(unit ? unit.accumulatedMinutes : 0),
        ongoingText:
          unit && unit.ongoing
            ? `${unit.ongoing.operatorName} 使用中 · ${formatMinutes(unit.ongoing.durationMinutes)}`
            : '',
      });
    } catch (error) {
      wx.showModal({
        title: '无法访问该设备',
        content: error.message || '加载失败',
        showCancel: false,
        success: () => {
          if (getCurrentPages().length > 1) wx.navigateBack();
          else wx.switchTab({ url: '/pages/index/index' });
        },
      });
    }
  },
  async startUsage() {
    if (this.data.loading || !this.data.item || !this.data.unit) return;
    this.setData({ loading: true });
    try {
      await request({
        url: '/mini/usage/start',
        method: 'POST',
        data: { itemId: this.data.item.id, unitId: this.data.unit.id },
      });
      wx.showToast({ title: '已开始使用' });
      await this.load();
    } catch (error) {
      wx.showToast({ title: error.message || '开始失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },
  async endUsage() {
    if (this.data.loading || !this.data.item || !this.data.unit) return;
    this.setData({ loading: true });
    try {
      await request({
        url: '/mini/usage/end',
        method: 'POST',
        data: { itemId: this.data.item.id, unitId: this.data.unit.id },
      });
      wx.showToast({ title: '已结束使用' });
      await this.load();
    } catch (error) {
      wx.showToast({ title: error.message || '结束失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },
});
