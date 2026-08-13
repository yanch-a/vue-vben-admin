<script>
  import {
    defineComponent,
    inject,
    onMounted,
    reactive,
    toRefs,
  } from 'vue'
  import { useRoute, useRouter } from 'vue-router'

  import { VbenTiptap } from '@vben/plugins/tiptap'
  import { useTabbarStore } from '@vben/stores'

  import { getTree } from '@/api/cms/cmsChannelApi'
  import { doEdit, getById } from '@/api/cms/cmsContentApi'
  import { getModelItemByChannelId } from '@/api/cms/cmsModelApi'
  import LemonUpload from '@/components/lemon-upload/index.vue'
  import { activeValue } from '@/utils/convert'
  import { parseTime } from '@/utils/index'
  import { backToListPage } from '@/utils/route-back'
  import { InfoFilled } from '@element-plus/icons-vue'

  export default defineComponent({
    name: 'CmsContentDetail',
    components: {
      LemonUpload,
      VbenTiptap,
      InfoFilled,
    },
    setup() {
      const $baseMessage = inject('$baseMessage')
      const route = useRoute()
      const router = useRouter()
      const tabbarStore = useTabbarStore()

      const state = reactive({
        elForm: null,
        projectTypeOptions: {},
        areaNoOptions: {
          "1":"选项一",
          "2":"选项二",
        },
        contentTypeOptions: {},
        modelIdOptions: [],
        route: { query: { title: '加载中' } },
        form: {
          orderNum: 10,
          modelId: 0,
          channelId: route.query.channelId ? parseInt(String(route.query.channelId)) : undefined,
          siteId: localStorage.getItem('defaultSiteId'),
          txt: {
            txt: '',
          }
        },
        rules: {
          title: [{ required: true, trigger: 'blur', message: '请输入标题'}],
          channelId: [{ required: true, trigger: 'change', message: '请选择所属栏目'}],
          releaseTime: [{ required: true, trigger: 'blur', message: '请选择发布时间'}],
          contentType: [{ required: true, trigger: 'change', message: '请选择内容类型'}],
        },
        title: '加载中',
        pageTitle: '内容详情',
        baseProps: [],
        extProps: [],
        defaultTreeSelectProps: {
          children: 'children',
          label: 'label',
        },
        treeData: [],
        activeName: 'base',
        modelName: '',
        id: route.query.id,
      })

      const goBack = async () => {
        await backToListPage(route, router, {
          listRouteName: 'CmsContent',
          fallbackPath: '/CMS/cmsContent',
        })
      }

      const save = () => {
        state.elForm.validate(async (valid) => {
          if (valid) {
            const { msg } = await doEdit(state.form)
            $baseMessage(msg, 'success', 'vab-hey-message-success')
            goBack()
          }
        })
      }

      const handleContentImg = (val) => {
        const list = Array.isArray(val) ? val : []
        const fileIds = list.map((item) => item.id)
        state.form.contentImg = fileIds.join(',')
      }

      const handleIds = (val) => {
        const list = Array.isArray(val) ? val : []
        const fileIds = list.map((item) => item.id)
        if(list.length>0){
          state.form.contentImg = list[0].url
          state.form.attIds = fileIds.join(',')
        }else{
          state.form.contentImg = ''
          state.form.attIds = ''
        }
      }

      const parseOptions = (raw) => {
        if (!raw) return null
        if (typeof raw === 'object') return raw
        try {
          return JSON.parse(raw)
        } catch {
          return null
        }
      }

      const fetchData = async () => {
        if(route.query.id){
          const { data } = await getById({id: route.query.id})
          if(!data.txt) {
            data.txt = {txt:''}
          }
          state.form = data
        }else {
          state.form.releaseTime = parseTime(new Date())
        }
      }

      const initChannelTree = async () => {
        const { data } = await getTree({
          siteId: state.form.siteId || localStorage.getItem('defaultSiteId'),
        })
        if(data && data.length>0){
          state.treeData.push(...data)
        }
      }

      const fetchItemDataByChannelId = async () => {
        if(state.form.channelId){
          const { data: { list, model }} = await getModelItemByChannelId({ channelId: state.form.channelId, modelType: 'content', display: 1 })
          if(list){
            state.baseProps = []
            state.extProps = []
            list.forEach((d) => {
              if(d.dataOptions){
                const dataOptions = JSON.parse(d.dataOptions)
                state[d.field + 'Options'] = dataOptions.options
              }
              if(d.defaultValue && !state.id) {
                state.form[d.field] = d.defaultValue
              }
              if(d.position==='base'){
                state.baseProps.push(d)
              }else if(d.position==='ext') {
                state.extProps.push(d)
              }
            })
          }
          state.form.modelId = model.id
          state.modelName = model.modelName
        }
      }

      onMounted(() => {
        const title = route.query.title || '内容详情'
        state.title = title
        state.pageTitle = title
        state.id = route.query.id
        tabbarStore.setTabTitle(route, String(title))

        initChannelTree()
        fetchItemDataByChannelId()
        fetchData()
      })

      return {
        ...toRefs(state),
        goBack,
        activeValue,
        save,
        handleContentImg,
        handleIds,
        parseOptions,
      }
    },
  })
</script>

<template>
  <div class="detail-container">
    <el-page-header :content="pageTitle" @back="goBack">
      <template #extra>
        <div class="flex items-center">
          <el-button class="ml-2" type="primary" @click="save">保存</el-button>
        </div>
      </template>
    </el-page-header>
    <el-tabs v-model="activeName" class="demo-tabs">
      <el-form ref="elForm" inline label-width="120px" :model="form" :rules="rules" size="large">
        <el-tab-pane label="基本信息" name="base">
          <el-row :gutter="20">
            <el-col :lg="16" :md="8" :sm="24" :xl="16" :xs="24">
              <el-card class="box-card">
                <el-row>
                  <template v-for="item in baseProps" :key="item.id">
                    <el-col v-if="item.field === 'title'" :span="24">
                      <el-form-item :label="item.fieldName" prop="title">
                        <el-input v-model="form.title" maxlength="200" placeholder="请输入标题" />
                      </el-form-item>
                    </el-col>
                    <el-col v-if="item.field === 'link'" :span="24">
                      <el-form-item :label="item.fieldName" prop="link">
                        <template #label>
                          <el-tooltip content="请以http 或 https开头" placement="top">
                            <el-icon style="height: 100%;"><InfoFilled /></el-icon>
                          </el-tooltip>
                          外部链接
                        </template>
                        <el-input v-model="form.link" maxlength="150" placeholder="请输入外部链接" />
                      </el-form-item>
                    </el-col>
                    <el-col v-if="item.field === 'description'" :span="24">
                      <el-form-item :label="item.fieldName" prop="description">
                        <el-input v-model="form.description" type="textarea" :maxlength="1000" placeholder="请输入描述" :autosize="{minRows: 4, maxRows: 4}" />
                      </el-form-item>
                    </el-col>
                    <el-col v-if="item.field === 'contentImg'" :span="24">
                      <el-form-item :label="item.fieldName" prop="contentImg">
                        <LemonUpload
                          :attach-code="parseOptions(item.dataOptions)?.attachCode || 'CmsContent'"
                          :limit="parseOptions(item.dataOptions)?.limit || 1"
                          :list-type="parseOptions(item.dataOptions)?.listType || 'picture-card'"
                          :ids="form.id"
                          @handle-file="handleIds"
                        />
                      </el-form-item>
                    </el-col>
                    <el-col v-if="item.field === 'txt'" :span="24">
                      <el-form-item :label="item.fieldName" prop="txt.txt" class="vab-quill-content">
                        <VbenTiptap v-model="form.txt.txt" :min-height="320" :max-height="560" />
                      </el-form-item>
                    </el-col>
                  </template>
                </el-row>
              </el-card>
            </el-col>
            <el-col :lg="8" :md="8" :sm="24" :xl="8" :xs="24">
              <el-card class="box-card">
                <el-row>
                  <template v-for="item in baseProps" :key="`side-${item.id}`">
                    <el-col v-if="item.field === 'modelId'" :span="24">
                      <el-form-item :label="item.fieldName" prop="modelId">
                        {{ modelName }}
                      </el-form-item>
                    </el-col>
                    <el-col v-if="item.field === 'channelId'" :span="24">
                      <el-form-item :label="item.fieldName" prop="channelId">
                        <el-tree-select
                          v-model="form.channelId"
                          check-strictly
                          :data="treeData"
                          highlight-current
                          node-key="id"
                          :props="defaultTreeSelectProps"
                          :render-after-expand="false"
                        />
                      </el-form-item>
                    </el-col>
                    <el-col v-if="item.field === 'projectCode'" :span="24">
                      <el-form-item :label="item.fieldName" prop="projectCode">
                        <el-input v-model="form.projectCode" maxlength="50" :placeholder="`请输入${ item.fieldName}`" />
                      </el-form-item>
                    </el-col>
                    <el-col v-if="item.field === 'projectType'" :span="24">
                      <el-form-item :label="item.fieldName" prop="projectType">
                        <el-select v-if="item.dataOptions != null" v-model="form.projectType">
                          <el-option
                            v-for="opt in (parseOptions(item.dataOptions) || [])"
                            :key="opt.value"
                            :label="opt.label"
                            :value="opt.value"
                          />
                        </el-select>
                        <el-input v-else v-model="form.projectType" maxlength="30" :placeholder="`请输入${ item.fieldName}`" />
                      </el-form-item>
                    </el-col>
                    <el-col v-if="item.field === 'author'" :span="24">
                      <el-form-item :label="item.fieldName" prop="author">
                        <el-input v-model="form.author" maxlength="30" :placeholder="`请输入${ item.fieldName}`" />
                      </el-form-item>
                    </el-col>
                    <el-col v-if="item.field === 'origin'" :span="24">
                      <el-form-item :label="item.fieldName" prop="origin">
                        <el-input v-model="form.origin" maxlength="30" :placeholder="`请输入${ item.fieldName}`" />
                      </el-form-item>
                    </el-col>
                    <el-col v-if="item.field === 'areaNo'" :span="24">
                      <el-form-item :label="item.fieldName" prop="areaNo">
                        <el-select v-if="item.dataOptions != null" v-model="form.areaNo">
                          <el-option
                            v-for="(label, value) in (parseOptions(item.dataOptions) || {})"
                            :key="value"
                            :label="label"
                            :value="value"
                          />
                        </el-select>
                        <el-input v-else v-model="form.areaNo" maxlength="30" :placeholder="`请输入${ item.fieldName}`" />
                      </el-form-item>
                    </el-col>
                    <el-col v-if="item.field === 'contentType'" :span="24">
                      <el-form-item :label="item.fieldName" prop="contentType">
                        <el-select v-model="form.contentType">
                          <el-option
                            v-for="opt in contentTypeOptions"
                            :key="opt.value"
                            :label="opt.label"
                            :value="opt.value"
                          />
                        </el-select>
                      </el-form-item>
                    </el-col>
                    <el-col v-if="item.field === 'releaseTime'" :span="24">
                      <el-form-item :label="item.fieldName" prop="releaseTime">
                        <el-date-picker v-model="form.releaseTime" type="datetime" value-format="YYYY-MM-DD HH:mm:ss" />
                      </el-form-item>
                    </el-col>
                  </template>
                </el-row>
              </el-card>
            </el-col>
          </el-row>
        </el-tab-pane>
      </el-form>
    </el-tabs>
  </div>
</template>

<style scoped>
.detail-container {
  padding: 12px;
}

.vab-quill-content :deep(.vben-tiptap) {
  width: 100%;
}
</style>
