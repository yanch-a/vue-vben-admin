<script>
  import {
    defineAsyncComponent,
    defineComponent,
    inject,
    onMounted,
    reactive,
    toRefs,
  } from 'vue'

  import { doDelete, doUpdate, getTree } from '@/api/menuManagement'
  import { getRoleList } from '@/api/roleManagement'
  // import { getList } from '@/api/router'
  import { activeValue, dictConvertObj } from '@/utils/convert'
  import { Plus } from '@element-plus/icons-vue'

  export default defineComponent({
    name: 'MenuManagement',
    components: {
      Edit: defineAsyncComponent(
        () => import('./components/MenuManagementEdit.vue')
      ),
    },
    setup() {
      const $baseConfirm = inject('$baseConfirm')
      const $baseMessage = inject('$baseMessage')

      const state = reactive({
        editRef: null,
        data: [],
        defaultProps: {
          children: 'children',
          label: 'label',
        },
        list: [],
        listLoading: true,
      })

      const handleEdit = (row) => {
        if (row && row.path) {
          state.editRef.showEdit(row)
        } else {
          state.editRef.showEdit()
        }
      }
      const updateVisible = async (row) => {
        if(!state.listLoading){
          if (row.menuId) {
            const { msg } = await doUpdate({ menuId: row.menuId, visible: row.visible })
            $baseMessage(msg, 'success', 'vab-hey-message-success')
            await fetchData()
          }
        }
      }
      const fetchData = async (role) => {
        state.listLoading = true
        const {
          data: { list },
        } = await getTree(role)
        state.list = dictConvertObj(list)
        state.listLoading = false
      }
      const handleNodeClick = (role) => {
        if(role.id == 'root') {
          role.id = 0
        }
        fetchData({ roleId: role.id })
      }

      getRoleList().then(({ list }) => {
        const tree = []
        const item = {
          id: 'root',
          label: '全部角色',
          children: [],
        }
        list.forEach((d) => {
          item.children.push({
            label: d.roleName,
            id: d.roleId,
            roleKey: d.roleKey,
          })
        })
        tree.push(item)
        state.data = tree
      })

      const handleDelete = (row) => {
        if (row.path) {
          $baseConfirm('你确定要删除当前项吗', null, async () => {
            const { msg } = await doDelete({ id: row.menuId })
            $baseMessage(msg, 'success', 'vab-hey-message-success')
            await fetchData()
          })
        }
      }

      onMounted(() => {
        console.log("开始加载")
        fetchData()
      })

      return {
        ...toRefs(state),
        handleEdit,
        handleDelete,
        fetchData,
        handleNodeClick,
        Plus,
        updateVisible,
        activeValue,
      }
    },
  })
</script>

<template>
  <div class="menu-management-container">
    <el-row :gutter="20">
      <el-col :lg="4" :md="8" :sm="24" :xl="4" :xs="24">
        <vab-card shadow="hover">
          <el-tree
            :data="data"
            :default-expanded-keys="['root']"
            node-key="id"
            :props="defaultProps"
            @node-click="handleNodeClick"
          />
        </vab-card>
      </el-col>
      <el-col :lg="20" :md="16" :sm="24" :xl="20" :xs="24">
        <vab-card shadow="hover">
          <vab-query-form>
            <vab-query-form-top-panel :span="12">
              <el-button v-permissions="{ permission: ['MenuManagement:aou'] }" :icon="Plus" type="primary" @click="handleEdit()">
                添加
              </el-button>
            </vab-query-form-top-panel>
          </vab-query-form>
          <el-table
            v-loading="listLoading"
            border
            :data="list"
            default-expand-all
            row-key="path"
            :tree-props="{ children: 'children', hasChildren: 'hasChildren' }"
          >
            <el-table-column label="菜单名称" prop="menuName" show-overflow-tooltip width="200" />
            <el-table-column label="name" prop="name" show-overflow-tooltip />
            <el-table-column label="路径" prop="path" show-overflow-tooltip />
            <el-table-column label="排序" prop="orderNum" />
            <el-table-column label="是否可见" prop="visible">
              <template #default="{ row }">
                <el-switch v-model="row.visible" :active-value="activeValue.active" :inactive-value="activeValue.inActive" @click.left="updateVisible(row)" />
              </template>
            </el-table-column>
            <el-table-column
              label="vue文件路径"
              prop="component"
              show-overflow-tooltip
            />
            <el-table-column label="是否为外链" prop="isFrame" show-overflow-tooltip />
            <el-table-column label="图标" show-overflow-tooltip>
              <template #default="{ row }">
                <vab-icon v-if="row.icon" :icon="row.icon" />
              </template>
            </el-table-column>
            <el-table-column label="是否缓存" prop="isCache" show-overflow-tooltip width="120" />
            <!-- <el-table-column label="badge" show-overflow-tooltip>
              <template #default="{ row }">
                <el-tag v-if="row.badge" effect="dark" type="danger">
                  {{ row.badge }}
                </el-tag>
              </template>
            </el-table-column> -->
            <!-- <el-table-column label="dot" show-overflow-tooltip>
              <template #default="{ row }">
                {{ row.dot ? '是' : '否' }}
              </template>
            </el-table-column> -->
            <el-table-column label="操作" show-overflow-tooltip width="200">
              <template #default="{ row }">
                <el-button v-permissions="{ permission: ['MenuManagement:aou'] }" text type="primary" @click="handleEdit(row)">
                  编辑
                </el-button>
                <el-button v-permissions="{ permission: ['MenuManagement:delete'] }" text type="primary" @click="handleDelete(row)">
                  删除
                </el-button>
              </template>
            </el-table-column>
            <template #empty>
              <!-- <el-image
                class="vab-data-empty"
                :src="require('@/assets/empty_images/data_empty.png')"
              /> -->
              <el-empty class="vab-data-empty" description="暂无数据" />
            </template>
          </el-table>
        </vab-card>
      </el-col>
    </el-row>
    <Edit ref="editRef" @fetch-data="fetchData" />
  </div>
</template>

<style lang="scss" scoped>
  $base: '.menu-management';
  #{$base}-container {
    /* 与全局 admin-plus-page 一致，不再贴边 */
    padding: 16px;
    background: var(--el-bg-color);
  }
</style>
