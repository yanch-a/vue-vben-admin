<script>
    import {
      defineAsyncComponent,
      defineComponent,
      inject,
      onMounted,
      reactive,
      toRefs,
    } from 'vue'

    import { doDelete, getPage } from '@/api/attachmentApi'
    import { baseURL } from '@/config'
    import { Delete, Plus, Search } from '@element-plus/icons-vue'

    export default defineComponent({
      name: 'AttachmentManage',
      components: {
        Edit: defineAsyncComponent(() =>
          import('./components/attachmentEdit.vue')
        ),
      },
      setup() {
        const $baseConfirm = inject('$baseConfirm')
        const $baseMessage = inject('$baseMessage')

        const state = reactive({
          editRef: null,
          list: [],
          listLoading: true,
          layout: 'total, sizes, prev, pager, next, jumper',
          total: 0,
          selectRows: '',
          queryForm: {
            pageNum: 1,
            pageSize: 10,
          },
        })

        const setSelectRows = (val) => {
          state.selectRows = val
        }
        const handleEdit = (row) => {
          if (row && row.id) {
            state.editRef.showEdit(row)
          } else {
            state.editRef.showEdit()
          }
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
        const fetchData = async () => {
          state.listLoading = true
          const {
           list, total
          } = await getPage(state.queryForm)
          state.list = list
          state.total = total
          state.listLoading = false
        }

        const isImage = (extension) => {
            const imageExtensions = ["jpg", "jpeg", "png", "gif", "bmp"];
            return imageExtensions.includes(extension);
        }

        const getUrl = (row) => {
            return baseURL + row.downloadUrl
        }
        const download = (row) => {
            const url = getUrl(row)
            window.open(url)
        }

        onMounted(() => {
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
          Delete,
          Plus,
          Search,
          isImage,
          getUrl,
          download
        }
      },
    })
  </script>

  <template>
    <div class="user-management-container">
      <vab-query-form>
        <vab-query-form-left-panel :span="12">
          <el-button v-permissions="{ permission: ['AttachmentManage:add'] }" :icon="Plus" type="primary" @click="handleEdit($event)">
            添加
          </el-button>
          <el-button v-permissions="{ permission: ['AttachmentManage:delete'] }" :icon="Delete" type="danger" @click="handleDelete($event)">
            批量删除
          </el-button>
        </vab-query-form-left-panel>
        <vab-query-form-right-panel :span="12">
          <el-form inline :model="queryForm" @submit.prevent>
            <el-form-item>
              <el-input
                v-model.trim="queryForm.originalName"
                clearable
                placeholder="请输入文件名称"
              />
            </el-form-item>
            <el-form-item>
              <el-input
                v-model.trim="queryForm.moduleCode"
                clearable
                placeholder="请输入业务分类"
              />
            </el-form-item>
            <el-form-item>
              <el-button :icon="Search" type="primary" @click="queryData">
                查询
              </el-button>
            </el-form-item>
          </el-form>
        </vab-query-form-right-panel>
      </vab-query-form>

      <el-table
        v-loading="listLoading"
        border
        :data="list"
        @selection-change="setSelectRows"
        :highlight-current-row="false"
      >
        <el-table-column align="center" show-overflow-tooltip type="selection" />
        <el-table-column align="center" label="文件名称" prop="originalName" show-overflow-tooltip />
        <el-table-column align="center" label="业务分类" prop="moduleCode" />
        <el-table-column align="center" label="文件类型" prop="attachType" />
        <el-table-column align="center" label="文件大小" prop="fileSize" />
        <el-table-column align="center" label="上传时间" prop="createTime" />
        <el-table-column align="center" label="下载地址" prop="createTime">
          <template #default="{ row }">
            <p>{{ getUrl(row) }}</p>
          </template>
        </el-table-column>
        <el-table-column align="center" label="预览">
            <template #default="{ row }">
                <template v-if="isImage(row.attachType)">
                    <el-image
                        :src="getUrl(row)"
                        :zoom-rate="1.2"
                        :max-scale="7"
                        :min-scale="0.2"
                        :preview-src-list="[getUrl(row)]"
                        :initial-index="4"
                        hide-on-click-modal
                        fit="cover"
/>
                </template>
            </template>
        </el-table-column>
        <el-table-column align="center" label="操作" width="180">
          <template #default="{ row }">
            <el-button v-permissions="{ permission: ['AttachmentManage:delete'] }" text type="primary" @click="handleDelete(row)">
              删除
            </el-button>
            <el-button text type="primary" @click="download(row)">
              下载
            </el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty class="vab-data-empty" description="暂无数据" />
        </template>
      </el-table>
      <el-pagination
        background
        :current-page="queryForm.pageNum"
        :layout="layout"
        :page-size="queryForm.pageSize"
        :total="total"
        @current-change="handleCurrentChange"
        @size-change="handleSizeChange"
      />
      <Edit ref="editRef" @fetch-data="fetchData" />
    </div>
  </template>
