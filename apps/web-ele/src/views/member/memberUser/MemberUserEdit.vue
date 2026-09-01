<script>
  import {
    defineComponent,
    inject,
    onMounted,
    reactive,
    toRefs,
  } from 'vue'
  import { useRoute, useRouter } from 'vue-router'

  import { useTabbarStore } from '@vben/stores'

  import { getMemberUserGroupList } from '@/api/member/memberUserGroup'
  import {
    checkUsername,
    doEdit,
    getById,
  } from '@/api/member/memberUserApi'
  import { getDictData } from '@/utils/convert'
  import { backToListPage } from '@/utils/route-back'
  import { Refresh } from '@element-plus/icons-vue'

  export default defineComponent({
    name: 'MemberUserDetail',
    setup() {
      const $baseMessage = inject('$baseMessage')
      const route = useRoute()
      const router = useRouter()
      const tabbarStore = useTabbarStore()

      const passwordValidator = (rule, value, callback) => {
        if (!value) {
          callback(new Error('请输入密码'))
        } else {
          callback()
        }
      }
      const repasswordValidator = (rule, value, callback) => {
        if (value != state.form.password) {
          callback(new Error('密码输入不一致'))
        } else {
          callback()
        }
      }
      /**
       * 用户名唯一性校验：新增必查；编辑仅在改名后查接口
       * @author yanch
       */
      const userNameValidator = async (rule, value, callback) => {
        const userName = (value || '').trim()
        if (!userName) {
          callback(new Error('请输入用户名'))
          return
        }
        if (userName.length < 2 || userName.length > 30) {
          callback(new Error('用户名长度必须在2-30个字符之间'))
          return
        }
        if (state.form.id && userName === state.originalUserName) {
          callback()
          return
        }
        try {
          const { data } = await checkUsername(userName)
          if (data === true || data === 1 || data === 'true') {
            callback()
          } else {
            callback(new Error('用户名已存在'))
          }
        } catch (e) {
          callback(new Error('校验用户名失败，请稍后重试'))
        }
      }

      const state = reactive({
        elForm: null,
        userGroupOptions: [],
        userStatusOptions: getDictData('userStatus').data,
        route: { query: { title: '加载中' } },
        /** 编辑回显的原始用户名，用于跳过未改名时的唯一性请求 */
        originalUserName: '',
        form: {
          userStatus: '1',
          password: '',
          repassword: '',
        },
        rules: {
          userName: [
            { required: true, trigger: 'blur', validator: userNameValidator },
          ],
          password: [
            { required: true, trigger: 'blur', validator: passwordValidator },
          ],
          repassword: [
            { required: true, trigger: 'blur', validator: repasswordValidator },
          ],
          userStatus: [
            { required: true, trigger: 'change', message: '请选择状态' },
          ],
        },
        title: '加载中',
        pageTitle: '会员用户',
      })

      const goBack = async () => {
        await backToListPage(route, router, {
          listRouteName: 'MemberUser',
          fallbackPath: '/member/memberUser',
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

      const fetchData = async () => {
        const groupRes = await getMemberUserGroupList({})
        state.userGroupOptions = groupRes.data || []
        if (route.query.id) {
          const { data } = await getById({ id: route.query.id })
          state.form = {
            ...data,
            repassword: data.password,
          }
          state.originalUserName = (data.userName || '').trim()
        } else {
          state.originalUserName = ''
        }
      }

      onMounted(() => {
        const title = route.query.title || '会员用户'
        state.title = title
        state.pageTitle = title
        tabbarStore.setTabTitle(route, String(title))
        fetchData()
      })

      return {
        ...toRefs(state),
        goBack,
        Refresh,
        save,
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
    <el-form
      ref="elForm"
      class="member-edit-form"
      label-width="120px"
      :model="form"
      :rules="rules"
      size="large"
    >
      <el-row :gutter="16">
        <el-col :span="12">
          <el-form-item label="用户名" prop="userName">
            <el-input
              v-model="form.userName"
              maxlength="30"
              placeholder="请输入用户名"
            />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="真实名称" prop="realName">
            <el-input
              v-model="form.realName"
              maxlength="30"
              placeholder="请输入真实名称"
            />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="密码" prop="password">
            <el-input
              v-model="form.password"
              type="password"
              maxlength="50"
              placeholder="请输入密码"
              show-password
            />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="重复密码" prop="repassword">
            <el-input
              v-model="form.repassword"
              type="password"
              maxlength="50"
              placeholder="请再次输入密码"
              show-password
            />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="会员分组" prop="userGroup">
            <el-select
              v-model="form.userGroup"
              clearable
              placeholder="请选择会员分组"
              style="width: 100%"
            >
              <el-option
                v-for="item in userGroupOptions"
                :key="item.id"
                :label="item.groupName"
                :value="item.id"
              />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="状态" prop="userStatus">
            <el-radio-group v-model="form.userStatus">
              <el-radio
                border
                v-for="(key, value) in userStatusOptions"
                :key="value"
                :value="value"
              >
                {{ key }}
              </el-radio>
            </el-radio-group>
          </el-form-item>
        </el-col>
      </el-row>
    </el-form>
  </div>
</template>

<style scoped>
.detail-container {
  padding: 12px 16px 24px;
}
.member-edit-form :deep(.el-form-item) {
  width: 100%;
}
.member-edit-form :deep(.el-form-item__content) {
  flex: 1;
  min-width: 0;
}
.member-edit-form :deep(.el-input),
.member-edit-form :deep(.el-select),
.member-edit-form :deep(.el-input-number) {
  width: 100%;
}
</style>
