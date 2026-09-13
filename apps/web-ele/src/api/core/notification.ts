import { requestClient } from '#/api/request';

/** SQL 工单站内通知。 */
export interface WorkOrderNotification {
  businessId: number | string;
  businessTitle?: string;
  businessRoute?: string;
  content: string;
  createTime?: string;
  id: number | string;
  isRead: number;
  notificationType: string;
  senderAvatar?: string;
  senderName?: string;
  title: string;
}

/** 获取当前用户最近的通知。 */
export function listWorkOrderNotificationsApi(limit = 20) {
  return requestClient.get<WorkOrderNotification[]>(
    '/admin/workOrderNotification/list',
    { params: { limit } },
  );
}

/** 获取未读通知数量。 */
export function unreadWorkOrderNotificationCountApi() {
  return requestClient.get<number>('/admin/workOrderNotification/unreadCount');
}

/** 标记一条通知为已读。 */
export function markWorkOrderNotificationReadApi(id: number | string) {
  return requestClient.post(`/admin/workOrderNotification/${id}/read`);
}

/** 标记全部通知为已读。 */
export function markAllWorkOrderNotificationsReadApi() {
  return requestClient.post('/admin/workOrderNotification/readAll');
}

/** 清除一条通知。 */
export function dismissWorkOrderNotificationApi(id: number | string) {
  return requestClient.post(`/admin/workOrderNotification/${id}/dismiss`);
}

/** 清除当前用户的全部通知。 */
export function clearWorkOrderNotificationsApi() {
  return requestClient.post('/admin/workOrderNotification/clear');
}
