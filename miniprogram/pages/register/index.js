const { request } = require('../../utils/request');

Page({
  data: {
    realName: '',
    depts: [],
    deptNames: [],
    deptIndex: -1,
    loading: false,
  },
  async onLoad() {
    const depts = await request({ url: '/public/dept' });
    this.setData({ depts, deptNames: depts.map((item) => item.name) });
  },
  onNameInput(e) {
    this.setData({ realName: e.detail.value });
  },
  onDeptChange(e) {
    this.setData({ deptIndex: Number(e.detail.value) });
  },
  async submit() {
    const dept = this.data.depts[this.data.deptIndex];
    if (!this.data.realName || !dept) {
      wx.showToast({ title: '请填写姓名并选择部门', icon: 'none' });
      return;
    }
    this.setData({ loading: true });
    try {
      const loginRes = await wx.login();
      await request({
        url: '/auth/wx-register',
        method: 'POST',
        data: { code: loginRes.code, realName: this.data.realName, deptId: dept.id },
      });
      wx.reLaunch({ url: '/pages/pending/index' });
    } catch (error) {
      wx.showToast({ title: error.message || '提交失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },
});
