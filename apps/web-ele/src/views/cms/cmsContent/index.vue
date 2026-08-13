<script>
  import {
    defineComponent,
    inject,
    onMounted,
    reactive,
    toRefs,
    watch,
  } from 'vue'
  import { useRouter } from 'vue-router'

  import { getTree } from '@/api/cms/cmsChannelApi'
  import { doDelete, getPage } from '@/api/cms/cmsContentApi'
  import { getDefaultSite } from '@/api/cms/siteApi'
  import { Delete, Edit as EditIcon, Plus, Search } from '@element-plus/icons-vue'

  export default defineComponent({
    name: 'CmsContentManage',
    components: {
    },
    setup() {
      const $baseConfirm = inject('$baseConfirm')
      const $baseMessage = inject('$baseMessage')
      const router = useRouter()
      const state = reactive({
        treeRef: null,
        data: [],
        treeData: [],
        list: [],
        listLoading: true,
        layout: 'total, sizes, prev, pager, next, jumper',
        total: 0,
        selectRows: '',
        queryForm: {
          pageNum: 1,
          pageSize: 10,
          channelId: null,
          siteId: localStorage.getItem('defaultSiteId'),
        },
        emptyShow: true,
        channelName: '',
      })

      watch(() => state.channelName, (val) => {
        state.treeRef?.filter(val)
      })

      const filterNode = (value, data) => {
        if (!value) return true
        return data.label.includes(value)
      }

      const handleNodeClick = (channel) => {
        if(channel.id == 'root') {
          state.queryForm.channelId = null
        } else {
          state.queryForm.channelId = channel.id
        }
        fetchData()
      }

      const setSelectRows = (val) => {
        state.selectRows = val
      }

      const handleEdit = (row) => {
        const query = row && row.id
          ? {
              id: row.id,
              channelId: row.channelId,
              title: '编辑-内容管理',
              timestamp: new Date().getTime(),
            }
          : {
              channelId: state.queryForm.channelId,
              title: '新增-内容管理',
              timestamp: new Date().getTime(),
            }
        if (!(row && row.id)) {
          if (state.queryForm.channelId == 0 || state.queryForm.channelId == null) {
            $baseMessage('请先选择左侧子栏目', 'error', 'vab-hey-message-error')
            return
          }
        }
        // 优先按菜单 name 跳转（CmsContentInfo），避免嵌套子路由匹配失败
        router.push({ name: 'CmsContentInfo', query }).catch(() => {
          router.push({ path: '/cmsContent/detail', query })
        })
      }

      const handleDelete = (row) => {
        if (row.id) {
          $baseConfirm('你确定要删除当前项吗', null, async () => {
            const { msg } = await doDelete({ ids: [row.id] })
            $baseMessage(msg, 'success', 'vab-hey-message-success')
            await fetchData()
          })
        } else {
          if (state.selectRows.length > 0) {
            const ids = state.selectRows.map((item) => item.id).join()
            $baseConfirm('你确定要删除选中项吗', null, async () => {
              const { msg } = await doDelete({ ids })
              $baseMessage(msg, 'success', 'vab-hey-message-success')
              await fetchData()
            })
          } else {
            $baseMessage('未选中任何行', 'error', 'vab-hey-message-error')
          }
        }
      }
      const handleSizeChange = (val) => {
        state.queryForm.pageSize = val
        fetchData()
      }
      const handleCurrentChange = (val) => {
        state.queryForm.pageNum = val
        fetchData()
      }
      const queryData = () => {
        state.queryForm.pageNum = 1
        fetchData()
      }
      const fetchChannelData = async () => {
        const { data } = await getTree(state.queryForm)
        state.data = data
        state.treeData.push({
          id: 0,
          label: '无',
          children: [],
        })
      }

      const fetchData = async () => {
        state.listLoading = true
        const {
         list, total
        } = await getPage(state.queryForm)
        state.list = list
        if(list.length>0){
          state.emptyShow = false
        }else {
          state.emptyShow = true
        }
        state.total = total
        state.listLoading = false
      }
      onMounted(async () => {
        if(!state.queryForm.siteId){
          const { data } = await getDefaultSite()
          state.queryForm.siteId = data.id
          localStorage.setItem('defaultSiteId', data.id)
        }
        fetchChannelData()
        fetchData()
      })
      return {
        ...toRefs(state),
        setSelectRows,
        handleEdit,
        handleDelete,
        handleSizeChange,
        handleCurrentChange,
        queryData,
        fetchData,
        Plus,
        Delete,
        EditIcon,
        Search,
        filterNode,
        handleNodeClick,
      }
    },
  })
</script>

<template>
  <div class="list-container">
    <el-row :gutter="20">
      <el-col :lg="4" :md="8" :sm="24" :xl="4" :xs="24">
        <vab-card shadow="hover">
          <el-input v-model="channelName" placeholder="请输入栏目名称" />
          <el-divider style="margin: 8px 0;" />
          <el-tree
            ref="treeRef"
            :data="data"
            default-expand-all
            :expand-on-click-node="false"
            highlight-current
            :filter-node-method="filterNode"
            node-key="id"
            @node-click="handleNodeClick"
          />
        </vab-card>
      </el-col>
      <el-col :lg="20" :md="16" :sm="24" :xl="20" :xs="24">
        <vab-card shadow="hover">
          <vab-query-form>
            <vab-query-form-left-panel :span="12">
              <el-button v-permissions="{ permission: ['CmsContent:add'] }" :icon="Plus" type="primary" @click="handleEdit($event)">
                新增
              </el-button>
              <el-button v-permissions="{ permission: ['CmsContent:batchDel'] }" :icon="Delete" type="danger" @click="handleDelete($event)">
                批量删除
              </el-button>
            </vab-query-form-left-panel>
            <vab-query-form-right-panel :span="12">
              <el-form inline :model="queryForm" @submit.prevent>
                <el-form-item>
                  <el-input v-model.trim="queryForm.title" clearable placeholder="请输入标题" />
                </el-form-item>
                <el-form-item>
                  <el-button :icon="Search" type="primary" @click="queryData">
                    查询
                  </el-button>
                </el-form-item>
              </el-form>
            </vab-query-form-right-panel>
          </vab-query-form>
          <el-col v-if="emptyShow" :span="24">
            <el-empty class="vab-data-empty" description="暂无数据" />
          </el-col>
          <el-col :span="24">
            <ul v-loading="listLoading">
              <li v-for="(item, index) in list" :key="index" class="list-item">
                <div class="list-item-meta">
                  <div class="list-item-meta-content" style="width: 70%;">
                    <div class="list-item-meta-title">
                        <p>
【 {{ item.channel?.channelName }} 】
                          <el-link type="primary" @click="handleEdit(item)">{{ item.title }}</el-link>
                        </p>
                    </div>
                    <div class="list-item-meta-item lm-list-item">
                      <div>
                        <p>来源：{{ item.origin }}</p>
                      </div>
                      <div>
                        <p>内容类型：{{ item.contentType }}</p>
                      </div>
                    </div>
                  </div>
                  <div class="list-item-meta-content" style="width: 30%;text-align: right;">
                    <div class="list-item-meta-title lm-list-item">
                      <div>
                        <p>发布人：{{ item.createBy }}</p>
                      </div>
                      <div>
                        <p>发布时间：{{ item.releaseTime }}</p>
                      </div>
                      <div>
                        <p>ID：{{ item.id }}</p>
                      </div>
                    </div>
                    <div class="list-item-meta-item">
                      <el-button v-permissions="{ permission: ['CmsContent:edit'] }" circle :icon="EditIcon" text type="primary" @click="handleEdit(item)" />
                      <el-button v-permissions="{ permission: ['CmsContent:delete'] }" circle :icon="Delete" text type="danger" @click="handleDelete(item)" />
                    </div>
                  </div>
                </div>
              </li>
            </ul>
          </el-col>
          <el-col :span="24">
            <el-pagination
              background
              :current-page="queryForm.pageNum"
              :layout="layout"
              :page-size="queryForm.pageSize"
              :total="total"
              @current-change="handleCurrentChange"
              @size-change="handleSizeChange"
            />
          </el-col>
        </vab-card>
      </el-col>
    </el-row>
  </div>
</template>
<style lang="scss" scoped>
  .list-container {
    ul {
      padding: 0;
      margin: 0;
      outline: none;
      list-style: none;

      .list-item {
        padding: 10px;
        border-bottom: 1px solid var(--el-border-color);

        &-meta {
          display: flex;
          flex: 1 1;
          align-items: flex-start;

          &-avatar {
            margin-right: 16px;

            :deep() {
              .el-image {
                width: 61px;
                height: 61px;
              }
            }
          }

          &-content {
            justify-content: left;
            color: rgb(0 0 0 / 85%);
          }

          &-title {
            overflow: hidden;
            text-overflow: ellipsis;
            font-size: 14px;
            color: rgb(0 0 0 / 85%);
            white-space: nowrap;
          }

          .lm-list-item {
            > div {
              display: inline-block;
              margin-right: 20px;
              color: rgb(0 0 0 / 45%);
            }
          }

          &-description {
            font-size: 14px;
            color: rgb(0 0 0 / 45%);
          }

          &-item {
            display: inline-block;
            height: 30px;
            font-size: 14px;
            vertical-align: middle;
            color: rgb(0 0 0 / 45%);

            > span {
              line-height: 30px;
            }

            > p {
              margin-top: 4px;
              margin-bottom: 0;
            }
          }

          :deep() {
            .el-progress {
              margin-top: 21px;
            }
          }
        }
      }

      p {
        margin: 7px 0;
        overflow: hidden;
      }
    }
  }
</style>
