<script lang="ts" setup>
/**
 * lemonDbClient 登录壳：左侧产品工作台，右侧认证表单
 * @author yanch
 */
import { computed } from 'vue';

import { ThemeToggle } from '@vben/layouts';
import { preferences } from '@vben/preferences';

import { branding, resolveAssetUrl } from '#/store/branding';

const appName = computed(
  () => branding.accountMark || preferences.app.name || 'lemonDbClient',
);
const logo = computed(
  () => resolveAssetUrl(branding.logo) || preferences.logo.source,
);
const pageTitle = computed(
  () => branding.pageTitle || '把数据库变成好用的工作台',
);
const pageDescription = computed(
  () => branding.pageDesc || '连接、查询、用 AI 读懂你的库',
);
const loginBackground = computed(() => resolveAssetUrl(branding.loginBg));
const brandStyle = computed(() => {
  if (!loginBackground.value) return undefined;
  return {
    backgroundImage: `linear-gradient(160deg, rgb(10 16 28 / 88%), rgb(12 20 36 / 72%)), url(${loginBackground.value})`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
  };
});
</script>

<template>
  <div class="lemon-auth">
    <aside class="lemon-auth__brand" :style="brandStyle">
      <div class="lemon-auth__grid" aria-hidden="true"></div>
      <div class="lemon-auth__orb lemon-auth__orb--a" aria-hidden="true"></div>
      <div class="lemon-auth__orb lemon-auth__orb--b" aria-hidden="true"></div>

      <div class="lemon-auth__brand-top">
        <img v-if="logo" :alt="appName" class="lemon-auth__logo" :src="logo" />
        <span>{{ appName }}</span>
      </div>

      <div class="lemon-auth__copy">
        <p class="lemon-auth__eyebrow">Visual Database Workbench</p>
        <h1>{{ pageTitle }}</h1>
        <p class="lemon-auth__desc">{{ pageDescription }}</p>
        <ul class="lemon-auth__feats">
          <li>
            <span>01</span>
            可视化拼查询，少写重复 SQL
          </li>
          <li>
            <span>02</span>
            AI 智能体读库、出数、写说明
          </li>
          <li>
            <span>03</span>
            多数据源连接与权限一体管理
          </li>
        </ul>
      </div>

      <div class="lemon-auth__console" aria-hidden="true">
        <div class="console-bar">
          <i></i><i></i><i></i>
          <em>query · sales_order</em>
        </div>
        <div class="console-body">
          <div class="console-sql">
            <b>SELECT</b> order_no, amount, created_at<br />
            <b>FROM</b> sales_order<br />
            <b>WHERE</b> status = <em>'paid'</em>
          </div>
          <div class="console-table">
            <span>order_no</span><span>amount</span><span>created_at</span>
            <span>SO-10428</span><span>12,800</span><span>09-06 21:18</span>
            <span>SO-10419</span><span>6,420</span><span>09-06 18:02</span>
          </div>
        </div>
      </div>
    </aside>

    <section class="lemon-auth__panel">
      <div class="lemon-auth__tools">
        <ThemeToggle />
      </div>
      <div class="lemon-auth__form">
        <RouterView />
      </div>
      <div class="lemon-auth__copy-right">
        <span>
          © {{ preferences.copyright.date }}
          {{ branding.companyName || preferences.copyright.companyName }}
        </span>
        <a
          v-if="branding.icp"
          :href="branding.icpLink || 'https://beian.miit.gov.cn/'"
          rel="noreferrer"
          target="_blank"
        >
          {{ branding.icp }}
        </a>
      </div>
    </section>
  </div>
</template>

<style scoped>
.lemon-auth {
  display: flex;
  min-height: 100%;
  overflow: hidden;
  background: hsl(var(--background));
}

.lemon-auth__brand {
  position: relative;
  display: none;
  flex-direction: column;
  justify-content: space-between;
  width: 52%;
  padding: 36px 48px 40px;
  overflow: hidden;
  color: #f6f1df;
  background:
    radial-gradient(900px 480px at 12% 8%, rgb(242 193 78 / 22%), transparent 55%),
    radial-gradient(700px 420px at 90% 88%, rgb(56 189 248 / 14%), transparent 50%),
    #0b1220;
}

@media (min-width: 960px) {
  .lemon-auth__brand {
    display: flex;
  }
}

.lemon-auth__grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgb(255 255 255 / 4%) 1px, transparent 1px),
    linear-gradient(90deg, rgb(255 255 255 / 4%) 1px, transparent 1px);
  background-size: 28px 28px;
  mask-image: radial-gradient(circle at 30% 20%, #000 20%, transparent 75%);
}

.lemon-auth__orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(40px);
}

.lemon-auth__orb--a {
  top: 12%;
  right: 12%;
  width: 180px;
  height: 180px;
  background: rgb(242 193 78 / 28%);
}

.lemon-auth__orb--b {
  bottom: 18%;
  left: 8%;
  width: 220px;
  height: 220px;
  background: rgb(45 212 191 / 16%);
}

.lemon-auth__brand-top,
.lemon-auth__copy,
.lemon-auth__console {
  position: relative;
  z-index: 1;
}

.lemon-auth__brand-top {
  display: flex;
  gap: 10px;
  align-items: center;
  font-size: 18px;
  font-weight: 650;
  letter-spacing: 0.02em;
}

.lemon-auth__logo {
  width: 36px;
  height: 36px;
  object-fit: contain;
}

.lemon-auth__eyebrow {
  margin: 0 0 10px;
  font-size: 12px;
  font-weight: 600;
  color: #f2c14e;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.lemon-auth__copy h1 {
  margin: 0;
  font-size: clamp(28px, 3vw, 40px);
  font-weight: 680;
  line-height: 1.25;
}

.lemon-auth__desc {
  max-width: 460px;
  margin: 14px 0 0;
  font-size: 15px;
  line-height: 1.7;
  color: rgb(246 241 223 / 72%);
}

.lemon-auth__feats {
  display: grid;
  gap: 10px;
  max-width: 440px;
  padding: 0;
  margin: 28px 0 0;
  list-style: none;
}

.lemon-auth__feats li {
  display: flex;
  gap: 12px;
  align-items: center;
  font-size: 14px;
  color: rgb(246 241 223 / 86%);
}

.lemon-auth__feats span {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 24px;
  font-size: 11px;
  font-weight: 700;
  color: #1a1400;
  background: #f2c14e;
  border-radius: 999px;
}

.lemon-auth__console {
  max-width: 520px;
  overflow: hidden;
  background: rgb(8 12 20 / 55%);
  border: 1px solid rgb(255 255 255 / 10%);
  border-radius: 14px;
  box-shadow: 0 18px 50px rgb(0 0 0 / 28%);
  backdrop-filter: blur(10px);
}

.console-bar {
  display: flex;
  gap: 6px;
  align-items: center;
  padding: 10px 14px;
  background: rgb(255 255 255 / 4%);
  border-bottom: 1px solid rgb(255 255 255 / 8%);
}

.console-bar i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #f2c14e;
}

.console-bar i:nth-child(2) {
  background: #5eead4;
}

.console-bar i:nth-child(3) {
  background: #94a3b8;
}

.console-bar em {
  margin-left: 8px;
  font-size: 12px;
  font-style: normal;
  color: rgb(246 241 223 / 55%);
}

.console-body {
  display: grid;
  gap: 12px;
  padding: 14px;
}

.console-sql {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.7;
  color: #d6e4ff;
}

.console-sql b {
  font-weight: 700;
  color: #f2c14e;
}

.console-sql em {
  font-style: normal;
  color: #5eead4;
}

.console-table {
  display: grid;
  grid-template-columns: 1.2fr 0.8fr 1fr;
  font-size: 12px;
  border: 1px solid rgb(255 255 255 / 8%);
  border-radius: 8px;
}

.console-table span {
  padding: 7px 10px;
  color: rgb(246 241 223 / 78%);
  border-top: 1px solid rgb(255 255 255 / 6%);
}

.console-table span:nth-child(-n + 3) {
  font-weight: 650;
  color: #f2c14e;
  background: rgb(242 193 78 / 8%);
  border-top: 0;
}

.lemon-auth__panel {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  background: hsl(var(--background));
}

.lemon-auth__tools {
  display: flex;
  justify-content: flex-end;
  padding: 16px 20px 0;
}

.lemon-auth__form {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  padding: 12px 28px 48px;
}

.lemon-auth__copy-right {
  position: absolute;
  right: 0;
  bottom: 12px;
  left: 0;
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}

.lemon-auth__copy-right a {
  color: inherit;
}
</style>
