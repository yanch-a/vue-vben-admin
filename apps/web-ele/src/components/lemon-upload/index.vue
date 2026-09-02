<script lang="ts" setup>
import type { UploadFile, UploadUserFile } from 'element-plus';

import { computed, ref, watch } from 'vue';

import { useAccessStore } from '@vben/stores';

import {
  getAttachments,
  getByBelongIds,
} from '@/api/attachmentApi';
import { baseURL, isPublicBrandAsset, publicAssetUrl } from '@/config';
import { ElButton, ElDialog, ElMessage, ElUpload } from 'element-plus';

defineOptions({ name: 'LemonUpload' });

const props = withDefaults(
  defineProps<{
    attachCode: string;
    attachIds?: string;
    belongIds?: string;
    ids?: string;
    imageUrl?: string;
    limit?: number;
    listType?: 'picture' | 'picture-card' | 'text';
    modelValue?: string;
    url?: string;
  }>(),
  {
    modelValue: '',
    url: '/attachment/upload',
    limit: 1,
    ids: '',
    attachIds: '',
    imageUrl: '',
    listType: 'picture-card',
    belongIds: '',
  },
);

const emit = defineEmits<{
  'handleFile': [any[]];
  success: [any];
  'update:modelValue': [string];
}>();

const accessStore = useAccessStore();
const fileList = ref<UploadUserFile[]>([]);
const dialogVisible = ref(false);
const dialogImageUrl = ref('');

const action = computed(() => {
  if (props.url.startsWith('http')) return props.url;
  return `${baseURL}${props.url.startsWith('/') ? '' : '/'}${props.url}`;
});

const headers = computed(() => {
  const token = accessStore.accessToken || '';
  return {
    Authorization: token ? `Bearer ${token}` : '',
    lmtoken: token,
  };
});

const data = computed(() => ({
  attachCode: props.attachCode,
}));

function resolveUrl(url?: string) {
  if (!url) return '';
  if (url.startsWith('http') || url.startsWith('blob:') || url.startsWith('data:')) {
    return url;
  }
  // public 目录下的站点根静态资源，挂到 Vite BASE_URL（/lmdb/view/）
  if (isPublicBrandAsset(url) || url.startsWith('/assets/')) {
    return isPublicBrandAsset(url) ? publicAssetUrl(url) : url;
  }
  return `${baseURL}${url.startsWith('/') ? '' : '/'}${url}`;
}

function emitHandleFile() {
  emit('handleFile', fileList.value as any[]);
  const paths = fileList.value.map((f: any) => f.url).filter(Boolean);
  emit('update:modelValue', paths.join(','));
}

async function loadByBelongIds(ids?: string) {
  if (!ids) {
    fileList.value = [];
    return;
  }
  try {
    const res: any = await getByBelongIds({ ids });
    const arr = res?.data || res || [];
    const list = Array.isArray(arr) ? arr : [];
    fileList.value = list.map((item: any) => ({
      id: item.id,
      name: item.originalName || item.originName || item.filename,
      url: resolveUrl(item.downloadUrl || item.url),
      status: 'success',
      uid: item.id,
    }));
  } catch {
    // ignore
  }
}

async function loadByAttachIds(ids?: string) {
  if (!ids) return;
  try {
    const res: any = await getAttachments({ ids });
    const arr = res?.data || res || [];
    const list = Array.isArray(arr) ? arr : [];
    fileList.value = list.map((item: any) => ({
      id: item.id,
      name: item.originalName || item.originName || item.filename,
      url: resolveUrl(item.downloadUrl || item.url),
      status: 'success',
      uid: item.id,
    }));
  } catch {
    // ignore
  }
}

function handleSuccess(response: any, file: UploadFile) {
  const payload = response?.data || response;
  if (!payload?.id) {
    ElMessage.error(response?.msg || '上传失败');
    return;
  }
  (file as any).id = payload.id;
  file.url = resolveUrl(payload.url || payload.downloadUrl);
  fileList.value = [
    ...fileList.value.filter((f) => f.uid !== file.uid),
    {
      id: payload.id,
      uid: file.uid!,
      name: payload.originalName || payload.originName || payload.filename || file.name,
      url: resolveUrl(payload.url || payload.downloadUrl),
      status: 'success',
    } as any,
  ];
  ElMessage.success('上传完成');
  emit('success', payload);
  emitHandleFile();
}

function handleRemove(file: UploadFile) {
  const id = (file as any).id;
  fileList.value = fileList.value.filter((item: any) => item.id !== id);
  emitHandleFile();
}

function handlePreview(file: UploadFile) {
  dialogImageUrl.value = file.url || '';
  dialogVisible.value = true;
}

function handleExceed() {
  ElMessage.error(`最多上传 ${props.limit} 个文件`);
}

function handleError(_err: any, file: UploadFile) {
  ElMessage.error(`文件[${file.name}]上传失败`);
}

// 与原版一致：ids 按归属业务 id 加载
watch(
  () => props.ids || props.belongIds,
  (val) => {
    if (val) void loadByBelongIds(val);
  },
  { immediate: true },
);

watch(
  () => props.attachIds,
  (val) => {
    if (val) void loadByAttachIds(val);
  },
  { immediate: true },
);

watch(
  () => props.imageUrl,
  (val) => {
    if (!val) return;
    if (fileList.value.length > 0) return;
    fileList.value = [
      {
        id: 'preview',
        name: '图片',
        url: resolveUrl(val),
        status: 'success',
        uid: Date.now(),
      } as any,
    ];
  },
  { immediate: true },
);
</script>

<template>
  <div>
    <ElUpload
      v-model:file-list="fileList"
      :action="action"
      :data="data"
      :headers="headers"
      :limit="limit"
      :list-type="listType"
      name="file"
      :on-error="handleError"
      :on-exceed="handleExceed"
      :on-preview="handlePreview"
      :on-remove="handleRemove"
      :on-success="handleSuccess"
    >
      <template v-if="listType === 'picture-card'">
        <span class="text-2xl leading-none">+</span>
      </template>
      <ElButton v-else type="primary" size="small">点击上传</ElButton>
    </ElUpload>

    <ElDialog v-model="dialogVisible" title="查看大图">
      <img class="w-full" :src="dialogImageUrl" alt="preview" />
    </ElDialog>
  </div>
</template>
