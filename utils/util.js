// utils/util.js

/**
 * 格式化时间
 * @param {Date} date - 日期对象
 * @param {string} format - 格式
 * @returns {string}
 */
const formatTime = (date, format = 'HH:MM') => {
  const hour = date.getHours().toString().padStart(2, '0');
  const minute = date.getMinutes().toString().padStart(2, '0');
  const second = date.getSeconds().toString().padStart(2, '0');
  
  if (format === 'HH:MM:SS') {
    return `${hour}:${minute}:${second}`;
  }
  return `${hour}:${minute}`;
};

/**
 * 格式化日期
 * @param {Date} date - 日期对象
 * @returns {string}
 */
const formatDate = (date) => {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * 显示加载提示
 * @param {string} title - 提示文字
 * @param {boolean} mask - 是否显示遮罩
 */
const showLoading = (title = '加载中...', mask = true) => {
  wx.showLoading({ title, mask });
};

/**
 * 隐藏加载提示
 */
const hideLoading = () => {
  wx.hideLoading();
};

/**
 * 显示提示
 * @param {string} title - 提示文字
 * @param {string} icon - 图标类型
 */
const showToast = (title, icon = 'none') => {
  wx.showToast({ title, icon, duration: 2000 });
};

/**
 * 显示确认弹窗
 * @param {object} options - 配置项
 * @returns {Promise}
 */
const showModal = (options) => {
  return new Promise((resolve) => {
    wx.showModal({
      ...options,
      success: (res) => {
        resolve(res.confirm);
      }
    });
  });
};

/**
 * 手机号验证
 * @param {string} phone - 手机号
 * @returns {boolean}
 */
const validatePhone = (phone) => {
  return /^1[3-9]\d{9}$/.test(phone);
};

/**
 * 防抖函数
 * @param {Function} fn - 要执行的函数
 * @param {number} delay - 延迟时间
 * @returns {Function}
 */
const debounce = (fn, delay = 300) => {
  let timer = null;
  return function(...args) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      fn.apply(this, args);
    }, delay);
  };
};

/**
 * 节流函数
 * @param {Function} fn - 要执行的函数
 * @param {number} delay - 延迟时间
 * @returns {Function}
 */
const throttle = (fn, delay = 300) => {
  let lastTime = 0;
  return function(...args) {
    const now = Date.now();
    if (now - lastTime >= delay) {
      lastTime = now;
      fn.apply(this, args);
    }
  };
};

module.exports = {
  formatTime,
  formatDate,
  showLoading,
  hideLoading,
  showToast,
  showModal,
  validatePhone,
  debounce,
  throttle
};