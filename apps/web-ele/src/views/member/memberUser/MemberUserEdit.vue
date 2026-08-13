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

  import { getMemberLevelList } from '@/api/member/memberLevelApi'
  import { doEdit, getById } from '@/api/member/memberUserApi'
  import { getById as getRoleById } from '@/api/userManagement'
  import LemonUpload from '@/components/lemon-upload/index.vue'
  import { activeValue, getDictData } from '@/utils/convert'
  import { backToListPage } from '@/utils/route-back'
  import { isEmail, isPhone } from '@/utils/validate'
  import { InfoFilled, Refresh } from '@element-plus/icons-vue'

  export default defineComponent({
    name: 'MemberUserDetail',
    components: {
      LemonUpload,
      InfoFilled,
    },
    setup() {
      const $baseMessage = inject('$baseMessage')
      const route = useRoute()
      const router = useRouter()
      const tabbarStore = useTabbarStore()

      // 手机号码自定义验证规则
      const telValidator = (rule, value, callback) => {
        if (!value) {
          callback(new Error('请输入手机号'))
        } else if (!isPhone(value)) {
          callback(new Error('手机号格式不正确'))
        } else {
          callback()
        }
      }
      // 重复密码自定义验证规则
      const emailValidator = (rule, value, callback) => {
        if (value) {
          if (!isEmail(value)) {
            callback(new Error('请输入正确格式电子邮箱'))
          } else {
            callback()
          }
        } else {
          callback()
        }
      }
      // 密码自定义验证规则
      const passwordValidator = (rule, value, callback) => {
        if (!value) {
          callback(new Error('请输入密码'))
        } else {
          callback()
        }
      }
      // 重复密码自定义验证规则
      const repasswordValidator = (rule, value, callback) => {
        if (value != state.form.password) {
          callback(new Error('密码输入不一致'))
        } else {
          callback()
        }
      }
      const state = reactive({
        elForm: null,
        userGroupOptions: {
          1: '会员',
          2: '超级会员',
        },
        userLevelOptions: [],
        sexOptions: getDictData('sex').data,
        userStatusOptions: getDictData('userStatus').data,
        route: { query: { title: '加载中' } },
        form: {
          integral: 0,
          userStatus: '1',
          password: '',
          repassword: '',
          openPermission: 0,
          openPermissionExpireTime: null,
        },

        rules: {
          userName: [
            { required: true, trigger: 'blur', message: '请输入用户名' },
          ],
          password: [
            { required: true, trigger: 'blur', validator: passwordValidator },
          ],
          repassword: [
            { required: true, trigger: 'blur', validator: repasswordValidator },
          ],
          // realName: [{ required: true, trigger: 'blur', message: '请输入真实名称'}],
          email: [{ trigger: 'blur', validator: emailValidator }],
          phoneNumber: [
            { required: true, trigger: 'blur', validator: telValidator },
          ],
          memberLevelId: [
            { required: true, trigger: 'change', message: '请选择会员级别' },
          ],
          // sex: [{ required: true, trigger: 'change', message: '请选择性别'}],
          userStatus: [
            { required: true, trigger: 'change', message: '请选择会员状态' },
          ],
        },
        title: '加载中',
        pageTitle: '会员详情',
        options: [],
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

      const handleAvatar = (val) => {
        const fileIds = val.map((item) => {
          return item.id
        })
        const avatarUrl = val.map((item) => {
          return item.url
        })
        state.form.avatar = avatarUrl.join(',')
        state.form.avatarIds = fileIds.join(',')
      }

      const fetchData = async () => {
        const { data } = await getMemberLevelList({})
        state.userLevelOptions = data
        if (route.query.id) {
          const { data } = await getById({ id: route.query.id })
          state.form = data
          state.form.repassword = data.password
        }
        const {
          data: { roles },
        } = await getRoleById({ userId: 0 })
        state.options = roles
      }

      onMounted(() => {
        const title = route.query.title || '会员详情'
        state.title = title
        state.pageTitle = title
        tabbarStore.setTabTitle(route, String(title))
        fetchData()
      })

      return {
        ...toRefs(state),
        goBack,
        Refresh,
        activeValue,
        save,
        handleAvatar,
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
      inline
      label-width="160px"
      :model="form"
      :rules="rules"
      size="large"
    >
      <el-row>
        <el-col :span="24">
          <el-form-item label="头像" prop="avatar">
            <template #label>
              <el-tooltip
                content="支持 jpg, png, gif, bmp, psd, jpeg 图片格式"
                placement="top"
              >
                <el-icon style="height: 100%"><InfoFilled /></el-icon>
              </el-tooltip>
              头像
            </template>
            <LemonUpload
              :image-url="form.avatar"
              :limit="1"
              attach-code="MemberUserAvatar"
              @handle-file="handleAvatar"
            />
          </el-form-item>
        </el-col>
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
              placeholder="请输入密码"
              show-password
            />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="邮箱" prop="email">
            <el-input
              v-model="form.email"
              maxlength="50"
              placeholder="请输入邮箱"
            />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="手机号" prop="phoneNumber">
            <el-input
              v-model="form.phoneNumber"
              maxlength="11"
              placeholder="请输入手机号"
            />
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="角色" prop="roleIds">
            <el-select v-model="form.roleId" placeholder="请选择角色">
              <el-option
                v-for="item in options"
                :key="item.roleId"
                :label="item.roleName"
                :value="item.roleId"
              />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="会员级别" prop="memberLevelId">
            <el-select
              v-model="form.memberLevelId"
              placeholder="请选择会员等级"
              clearable
            >
              <el-option
                v-for="item in userLevelOptions"
                :key="item.id"
                :label="item.levelName"
                :value="item.id"
              />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="会员积分" prop="integral">
            <el-input-number
              v-model="form.integral"
              :precision="2"
              :step="1"
              :max="999999999"
            />
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="会员组" prop="userGroup">
            <el-select v-model="form.userGroup">
              <el-option
                v-for="(key, value) in userGroupOptions"
                :key="value"
                :label="key"
                :value="value"
              />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="性别" prop="sex">
            <el-radio-group v-model="form.sex">
              <el-radio
                border
                v-for="item in sexOptions"
                :key="item.code"
                :value="item.code"
              >
                {{ item.label }}
              </el-radio>
            </el-radio-group>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="会员状态" prop="userStatus">
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
        <el-col :span="8">
          <el-form-item label="是否开放权限" prop="openPermission">
            <el-radio-group v-model="form.openPermission">
              <el-radio border :value="0">否</el-radio>
              <el-radio border :value="1">是</el-radio>
            </el-radio-group>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item
            label="开放权限到期时间"
            prop="openPermissionExpireTime"
          >
            <el-date-picker
              v-model="form.openPermissionExpireTime"
              type="datetime"
              placeholder="选择日期时间"
              format="YYYY-MM-DD HH:mm:ss"
              value-format="YYYY-MM-DD HH:mm:ss"
              :disabled="form.openPermission !== 1"
            />
          </el-form-item>
        </el-col>
        <el-col :span="24">
          <el-form-item label="个性签名" prop="personalSignature">
            <el-input
              v-model="form.personalSignature"
              type="textarea"
              :maxlength="500"
              placeholder="请输入个性签名"
              :autosize="{ minRows: 4, maxRows: 4 }"
            />
          </el-form-item>
        </el-col>
      </el-row>
    </el-form>
  </div>
</template>
