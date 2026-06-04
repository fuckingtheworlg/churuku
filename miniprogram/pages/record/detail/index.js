const { request, asset } = require('../../../utils/request');

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

function statusText(status) {
  if (status === 'in_stock') return '在库可用';
  if (status === 'out') return '已出库（在外）';
  if (status === 'retired') return '已到期/停用';
  return status || '-';
}

Page({
  data: {
    id: '',
    record: null,
    units: [],
    photoUrls: [],
    signatureUrl: '',
    previewUrls: [],
    loadingUnitId: 0,
  },
  onLoad(options) {
    this.setData({ id: options.id });
    this.load();
  },
  async load() {
    let record;
    try {
      record = await request({ url: `/mini/stock-record/${this.data.id}` });
    } catch (error) {
      wx.showModal({
        title: '无法访问该记录',
        content: error.message || '加载失败',
        showCancel: false,
        success: () => {
          if (getCurrentPages().length > 1) wx.navigateBack();
        },
      });
      return;
    }
    const photoUrls = (record.photos || []).map(asset);
    const signatureUrl = asset(record.signatureUrl);
    this.setData({
      record: {
        ...record,
        typeText: record.type === 'in' ? '入库' : '出库',
        occurredAtText: formatDateTime(record.occurredAt),
      },
      photoUrls,
      signatureUrl,
      previewUrls: signatureUrl ? [...photoUrls, signatureUrl] : photoUrls,
    });
    await this.loadUnits(record);
  },
  async loadUnits(record) {
    if (record.type !== 'out' || !Array.isArray(record.units) || !record.units.length) {
      this.setData({ units: [] });
      return;
    }
    const views = [];
    for (const ou of record.units) {
      try {
        const res = await request({ url: `/mini/unit/${ou.unitId}` });
        const unit = res.unit;
        if (!unit) continue;
        views.push({
          id: unit.id,
          itemId: ou.itemId,
          code: unit.code,
          statusText: statusText(unit.status),
          status: unit.status,
          inUse: unit.inUse,
          accumulatedText: formatMinutes(unit.accumulatedMinutes),
          ongoingText: unit.ongoing
            ? `${unit.ongoing.operatorName} 使用中 · ${formatMinutes(unit.ongoing.durationMinutes)}`
            : '',
        });
      } catch (error) {
        // skip unreachable unit
      }
    }
    this.setData({ units: views });
  },
  async startUnit(event) {
    await this.usageAction(event, 'start');
  },
  async endUnit(event) {
    await this.usageAction(event, 'end');
  },
  async usageAction(event, action) {
    const { id, itemId } = event.currentTarget.dataset;
    if (!id || this.data.loadingUnitId) return;
    this.setData({ loadingUnitId: id });
    try {
      await request({
        url: `/mini/usage/${action}`,
        method: 'POST',
        data: { itemId: Number(itemId), unitId: Number(id) },
      });
      wx.showToast({ title: action === 'start' ? '已开始使用' : '已结束使用' });
      await this.load();
    } catch (error) {
      wx.showToast({ title: error.message || '操作失败', icon: 'none' });
    } finally {
      this.setData({ loadingUnitId: 0 });
    }
  },
  previewImage(event) {
    const { current } = event.currentTarget.dataset;
    if (!this.data.previewUrls.length) return;
    wx.previewImage({ current, urls: this.data.previewUrls });
  },
});
