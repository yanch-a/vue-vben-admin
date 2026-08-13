/**
 * 会员订单管理API
 */
import request from '@/utils/request'

/**
 * 获取订单分页列表（后台管理）
 */
export function getOrderPage(params) {
  return request({
    url: '/admin/member/order/page',
    method: 'get',
    params,
  })
}

/**
 * 获取当前用户订单列表（我的订单）- 与 /member/order/myOrders 对接
 * @param {Object} data - { query: { orderStatus }, pageNum, pageSize }
 */
export function getMyOrders(data) {
  return request({
    url: '/member/order/myOrders',
    method: 'post',
    data,
  })
}

/**
 * 根据ID获取订单详情
 */
export function getOrderById(params) {
  return request({
    url: `/admin/member/order/${params.id}`,
    method: 'get',
  })
}

/**
 * 获取订单的支付记录
 */
export function getPaymentRecord(params) {
  return request({
    url: `/member/payment/record/${params.orderNo}`,
    method: 'get',
  })
}

/**
 * 取消订单
 */
export function cancelOrder(params) {
  return request({
    url: `/member/order/cancel/${params.orderNo}`,
    method: 'post',
  })
}

/**
 * 查询订单状态
 */
export function queryOrderStatus(params) {
  return request({
    url: `/member/order/status/${params.orderNo}`,
    method: 'get',
  })
}

/**
 * 删除订单
 */
export function deleteOrder(params) {
  return request({
    url: `/admin/member/order/${params.id}`,
    method: 'delete',
  })
}
