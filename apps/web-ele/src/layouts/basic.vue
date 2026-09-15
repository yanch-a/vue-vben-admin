<script lang="ts" setup>
import type { NotificationItem } from '@vben/layouts';

import type { WorkOrderNotification } from '#/api';

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import { AuthenticationLoginExpiredModal } from '@vben/common-ui';
import { useWatermark } from '@vben/hooks';
import { CircleHelp, SvgGithubIcon } from '@vben/icons';
import {
  BasicLayout,
  LockScreen,
  Notification,
  UserDropdown,
} from '@vben/layouts';
import {
  preferences,
  updatePreferences,
  usePreferences,
} from '@vben/preferences';
import { useAccessStore, useUserStore } from '@vben/stores';
import { openWindow } from '@vben/utils';

import {
  clearWorkOrderNotificationsApi,
  dismissWorkOrderNotificationApi,
  listWorkOrderNotificationsApi,
  markAllWorkOrderNotificationsReadApi,
  markWorkOrderNotificationReadApi,
  unreadWorkOrderNotificationCountApi,
  verifyLockScreenPasswordApi,
} from '#/api';
import { $t } from '#/locales';
import { useAuthStore } from '#/store';
import LoginForm from '#/views/_core/authentication/login.vue';

/** lemonDbClient 仓库与 Issues */
const GITHUB_URL = 'https://github.com/yanch-a/LemonDbClient';
const GITHUB_ISSUES_URL = `${GITHUB_URL}/issues`;

const router = useRouter();
const userStore = useUserStore();
const authStore = useAuthStore();
const accessStore = useAccessStore();
const { destroyWatermark, updateWatermark } = useWatermark();
const { isDark } = usePreferences();
/** 站内通知轮询间隔：10 分钟 */
const NOTIFICATION_POLL_MS = 10 * 60 * 1000;

const notifications = ref<NotificationItem[]>([]);
const unreadNotificationCount = ref(0);
const notificationRefreshing = ref(false);
let notificationTimer: ReturnType<typeof setInterval> | undefined;

// 清除旧版本曾持久化的临时锁屏密码；新模式只保存“是否锁屏”。
accessStore.clearLockScreenPassword();
// 该应用的 SQL 工单通知属于业务入口，固定显示在右上角，兼容旧版本持久化的隐藏配置。
updatePreferences({
  widget: {
    notification: true,
    notificationButtonPosition: 'header',
  },
});

const menus = computed(() => [
  {
    handler: () => {
      router.push({ name: 'Profile' });
    },
    icon: 'lucide:user',
    text: $t('page.auth.profile'),
  },
  {
    handler: () => {
      openWindow(GITHUB_URL, {
        target: '_blank',
      });
    },
    icon: SvgGithubIcon,
    text: 'GitHub',
  },
  {
    handler: () => {
      openWindow(GITHUB_ISSUES_URL, {
        target: '_blank',
      });
    },
    icon: CircleHelp,
    text: $t('ui.widgets.qa'),
  },
]);

const avatar = computed(() => {
  return userStore.userInfo?.avatar ?? preferences.app.defaultAvatar;
});

const email = computed(
  () => userStore.userInfo?.email || $t('page.profile.emailUnset'),
);
const signature = computed(() => userStore.userInfo?.personalSignature || '');

/** 将后台通知转换成框架通知组件需要的展示结构。 */
function toNotificationItem(item: WorkOrderNotification): NotificationItem {
  const isPendingOrder =
    item.notificationType === 'SQL_WORK_ORDER_PENDING_REVIEW';
  return {
    ...item,
    avatar: item.senderAvatar || preferences.app.defaultAvatar,
    date: item.createTime
      ? new Date(item.createTime).toLocaleString(preferences.app.locale)
      : '',
    isRead: item.isRead === 1,
    message: isPendingOrder
      ? $t('page.notification.sqlWorkOrderPendingMessage', {
          submitter: item.senderName || '-',
          title: item.businessTitle || '-',
        })
      : item.content,
    title: isPendingOrder
      ? $t('page.notification.sqlWorkOrderPendingTitle')
      : item.title,
  };
}

/** 拉取通知和未读数；自动触发时静默失败，手动刷新仍展示请求错误。 */
async function loadNotifications(options?: { manual?: boolean; silent?: boolean }) {
  if (options?.manual) {
    notificationRefreshing.value = true;
  }
  try {
    const [items, unread] = await Promise.all([
      listWorkOrderNotificationsApi(20, {
        showErrorMessage: !options?.silent,
      }),
      unreadWorkOrderNotificationCountApi({
        showErrorMessage: !options?.silent,
      }),
    ]);
    notifications.value = (items || []).map((item) => toNotificationItem(item));
    unreadNotificationCount.value = Number(unread || 0);
  } catch {
    // 保留上一次成功结果，避免临时网络抖动造成通知列表闪空。
  } finally {
    if (options?.manual) {
      notificationRefreshing.value = false;
    }
  }
}

/** 手动刷新通知列表。 */
async function handleNotificationRefresh() {
  await loadNotifications({ manual: true });
}

/** 窗口重新获得焦点时后台刷新通知，不因临时服务异常弹窗。 */
function handleWindowFocus() {
  void loadNotifications({ silent: true });
}

async function handleNotificationRead(item: NotificationItem) {
  await markWorkOrderNotificationReadApi(item.id);
  await loadNotifications();
}

async function handleNotificationClick(item: NotificationItem) {
  if (!item.isRead) await markWorkOrderNotificationReadApi(item.id);
  await loadNotifications();
  if (item.businessId) {
    await router.push({
      name: 'SqlWorkOrder',
      query: { orderId: String(item.businessId) },
    });
  }
}

async function handleNotificationRemove(item: NotificationItem) {
  await dismissWorkOrderNotificationApi(item.id);
  await loadNotifications();
}

async function handleNotificationReadAll() {
  await markAllWorkOrderNotificationsReadApi();
  await loadNotifications();
}

async function handleNotificationClear() {
  await clearWorkOrderNotificationsApi();
  await loadNotifications();
}

onMounted(() => {
  void loadNotifications({ silent: true });
  notificationTimer = setInterval(
    () => void loadNotifications({ silent: true }),
    NOTIFICATION_POLL_MS,
  );
  window.addEventListener('focus', handleWindowFocus);
});

onBeforeUnmount(() => {
  if (notificationTimer) clearInterval(notificationTimer);
  window.removeEventListener('focus', handleWindowFocus);
});

async function handleLogout() {
  await authStore.logout(false);
}

/**
 * 将解锁密码交给后台按当前登录用户校验。
 * 只有接口成功才返回 true，失败信息由统一请求层展示。
 *
 * @author yanch
 */
async function verifyLockScreenPassword(password: string): Promise<boolean> {
  await verifyLockScreenPasswordApi(password);
  return true;
}

watch(
  () => ({
    enable: preferences.app.watermark,
    content: preferences.app.watermarkContent,
    isDark: isDark.value,
  }),
  async ({ enable, content, isDark: isDarkValue }) => {
    if (enable) {
      const watermarkColor = isDarkValue
        ? 'rgba(255, 255, 255, 0.12)'
        : 'rgba(0, 0, 0, 0.12)';

      await updateWatermark({
        advancedStyle: {
          colorStops: [
            {
              color: watermarkColor,
              offset: 0,
            },
            {
              color: watermarkColor,
              offset: 1,
            },
          ],
          type: 'linear',
        },
        content:
          content ||
          `${userStore.userInfo?.username} - ${userStore.userInfo?.realName}`,
      });
    } else {
      destroyWatermark();
    }
  },
  {
    immediate: true,
  },
);
</script>

<template>
  <BasicLayout
    :avatar
    :text="userStore.userInfo?.realName"
    lock-screen-mode="account"
    @clear-preferences-and-logout="handleLogout"
    @logout="handleLogout"
  >
    <template #user-dropdown>
      <UserDropdown
        :avatar
        :menus
        :text="userStore.userInfo?.realName"
        :description="email"
        lock-screen-mode="account"
        tag-text="Pro"
        @clear-preferences-and-logout="handleLogout"
        @logout="handleLogout"
      />
    </template>
    <template #notification>
      <Notification
        class="mr-1"
        :dot="unreadNotificationCount > 0"
        :notifications="notifications"
        :refreshing="notificationRefreshing"
        @clear="handleNotificationClear"
        @make-all="handleNotificationReadAll"
        @on-click="handleNotificationClick"
        @read="handleNotificationRead"
        @refresh="handleNotificationRefresh"
        @remove="handleNotificationRemove"
        @view-all="router.push({ name: 'SqlWorkOrder' })"
      />
    </template>
    <template #extra>
      <AuthenticationLoginExpiredModal
        v-model:open="accessStore.loginExpired"
        :avatar
      >
        <LoginForm />
      </AuthenticationLoginExpiredModal>
    </template>
    <template #lock-screen>
      <LockScreen
        :avatar
        :signature
        :verify-password="verifyLockScreenPassword"
        @to-login="handleLogout"
      />
    </template>
  </BasicLayout>
</template>
