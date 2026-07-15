// static/api/request.js
const app = getApp();

/**
 * 网络请求封装
 * @param {string} url - 请求路径
 * @param {object} options - 请求选项
 * @returns {Promise}
 */
const request = (url, options = {}) => {
  return new Promise((resolve, reject) => {
    const token = wx.getStorageSync('token');
    
    wx.request({
      url: app.globalData.apiBaseUrl + url,
      method: options.method || 'GET',
      data: options.data || {},
      header: {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : ''
      },
      success: (res) => {
        if (res.statusCode === 200) {
          if (res.data.code === 0) {
            resolve(res.data.data);
          } else {
            reject(res.data.message || '请求失败');
          }
        } else if (res.statusCode === 401) {
          // 未授权，清除登录信息
          wx.clearStorageSync();
          reject('登录已过期，请重新登录');
        } else {
          reject(`网络错误: ${res.statusCode}`);
        }
      },
      fail: (err) => {
        console.error('请求失败', err);
        reject(err.errMsg || '网络请求失败');
      }
    });
  });
};

// 封装常用方法
const get = (url, data) => request(url, { method: 'GET', data });
const post = (url, data) => request(url, { method: 'POST', data });
const put = (url, data) => request(url, { method: 'PUT', data });
const del = (url, data) => request(url, { method: 'DELETE', data });

module.exports = {
  request,
  get,
  post,
  put,
  delete: del
};