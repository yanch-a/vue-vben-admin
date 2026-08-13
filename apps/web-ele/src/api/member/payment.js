/**
 * 会员支付相关API
 */
import request from '@/utils/request'

/**
 * 获取会员等级列表及价格
 */
export function getMemberLevels() {
  return request({
    url: '/member/payment/levels',
    method: 'get'
  })
}

/**
 * 获取单次接口价格配置
 */
export function getApiPrice() {
  return request({
    url: '/member/payment/api-price',
    method: 'get'
  })
}

/**
 * 创建订单并发起支付
 * @param {Object} data - 订单数据
 */
export function createOrder(data) {
  return request({
    url: '/member/order/create',
    method: 'post',
    data
  })
}

/**
 * 查询订单状态
 * @param {String} orderNo - 订单号
 */
export function queryOrderStatus(orderNo) {
  return request({
    url: `/member/order/status/${orderNo}`,
    method: 'get'
  })
}

/**
 * 取消订单
 * @param {String} orderNo - 订单号
 */
export function cancelOrder(orderNo) {
  return request({
    url: `/member/order/cancel/${orderNo}`,
    method: 'post'
  })
}

/**
 * 获取当前用户的订单列表
 * @param {Number} pageNum - 页码
 * @param {Number} pageSize - 每页数量
 */
export function getUserOrders(pageNum, pageSize) {
  return request({
    url: '/member/payment/orders',
    method: 'get',
    params: { pageNum, pageSize }
  })
}

/**
 * 获取当前用户的支付记录
 * @param {Number} pageNum - 页码
 * @param {Number} pageSize - 每页数量
 */
export function getPaymentRecords(pageNum, pageSize) {
  return request({
    url: '/member/payment/records',
    method: 'get',
    params: { pageNum, pageSize }
  })
}

/**
 * 获取订单的支付记录
 * @param {String} orderNo - 订单号
 */
export function getPaymentRecordByOrderNo(orderNo) {
  return request({
    url: `/member/payment/record/${orderNo}`,
    method: 'get'
  })
}

