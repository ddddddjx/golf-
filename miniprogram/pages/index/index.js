Page({
  data: { history: [] },

  onShow() {
    this.setData({ history: wx.getStorageSync('tr4ce_history') || [] });
  },

  goRecord() {
    wx.navigateTo({ url: '/pages/record/record' });
  },
});
