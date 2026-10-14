<script>
  import { defineComponent, inject, nextTick, reactive, toRefs } from 'vue'

  import { getMemberUserGroupList } from '@/api/member/memberUserGroup'
  import {
    checkUsername,
    doEdit,
    getById,
  } from '@/api/member/memberUserApi'
  import { getOptionselect } from '@/api/roleManagement'
  import { ipWhitelistError } from '@/views/member/memberUser/ipWhitelist'
  import { getDictData } from '@/utils/convert'

  /**
   * 新增会员时的表单默认值；每次打开新增弹窗都生成新对象，避免沿用上一次编辑的数据
   */
  const createDefaultForm = () => ({
    userStatus: '1',
    /** 与自助注册一致：默认普通会员角色 */
    roleId: 2,
    password: '',
    repassword: '',
    ipWhitelist: '',
  })

  /**
   * 会员用户新增/编辑弹窗
   * 用法：父组件通过 ref 调用 showEdit(row)，row 为空表示新增；保存成功后触发 fetchData 事件刷新列表
   */
  export default defineComponent({
    name: 'MemberUserDialog',
    emits: ['fetchData'],
    setup(props, { emit }) {
      const $baseMessage = inject('$baseMessage')

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
        title: '',
        dialogFormVisible: false,
        /** 打开弹窗时加载下拉选项、回显数据的 loading */
        loading: false,
        /** 保存中，防止重复提交 */
        saving: false,
        userGroupOptions: [],
        /** 系统角色下拉（会员单角色 roleId） */
        roleOptions: [],
        /** 下拉选项只需加载一次，后续打开弹窗直接复用 */
        optionsLoaded: false,
        userStatusOptions: getDictData('userStatus').data,
        /** 编辑回显的原始用户名，用于跳过未改名时的唯一性请求 */
        originalUserName: '',
        form: createDefaultForm(),
        rules: {
          userName: [
            { required: true, trigger: 'blur', validator: userNameValidator },
          ],
          email: [
            { type: 'email', trigger: 'blur', message: '邮箱格式不正确' },
          ],
          password: [
            { required: true, trigger: 'blur', validator: passwordValidator },
          ],
          repassword: [
            { required: true, trigger: 'blur', validator: repasswordValidator },
          ],
          roleId: [
            { required: true, trigger: 'change', message: '请选择角色' },
          ],
          userStatus: [
            { required: true, trigger: 'change', message: '请选择状态' },
          ],
          ipWhitelist: [{
            trigger: 'blur',
            validator: (_rule, value, callback) => {
              const message = ipWhitelistError(value)
              if (message) {
                callback(new Error(message))
                return
              }
              callback()
            },
          }],
        },
      })

      /** 加载会员分组、角色下拉选项（仅首次打开时请求） */
      const loadOptions = async () => {
        if (state.optionsLoaded) return
        const [groupRes, roleRes] = await Promise.all([
          getMemberUserGroupList({}),
          getOptionselect(),
        ])
        state.userGroupOptions = groupRes.data || []
        state.roleOptions = roleRes.data || []
        state.optionsLoaded = true
      }

      /**
       * 打开弹窗
       * @param row 列表行数据；为空表示新增，否则按 id 拉取详情进行编辑
       */
      const showEdit = async (row) => {
        const isEdit = !!(row && row.id)
        state.title = isEdit ? `编辑会员用户【${row.userName || row.id}】` : '新增会员用户'
        state.form = createDefaultForm()
        state.originalUserName = ''
        state.dialogFormVisible = true
        state.loading = true
        try {
          await loadOptions()
          if (isEdit) {
            const { data } = await getById({ id: row.id })
            if (!data) {
              $baseMessage('未查到相关数据', 'error', 'vab-hey-message-error')
              state.dialogFormVisible = false
              return
            }
            state.form = {
              ...data,
              repassword: data.password,
              ipWhitelist: data.ipWhitelist || '',
            }
            state.originalUserName = (data.userName || '').trim()
          }
        } finally {
          state.loading = false
        }
        // 弹窗复用同一个表单实例，切换新增/编辑时清掉上一次残留的校验提示
        await nextTick()
        state.elForm?.clearValidate()
      }

      const close = () => {
        state.dialogFormVisible = false
      }

      /** 弹窗完全关闭后重置表单，避免下次打开闪现旧数据 */
      const onClosed = () => {
        state.form = createDefaultForm()
        state.originalUserName = ''
        state.elForm?.clearValidate()
      }

      const save = () => {
        state.elForm.validate(async (valid) => {
          if (!valid) return
          state.saving = true
          try {
            const { msg } = await doEdit(state.form)
            $baseMessage(msg, 'success', 'vab-hey-message-success')
            emit('fetchData')
            close()
          } finally {
            state.saving = false
          }
        })
      }

      return {
        ...toRefs(state),
        showEdit,
        close,
        onClosed,
        save,
      }
    },
  })
</script>

<template>
  <el-dialog
    v-model="dialogFormVisible"
    append-to-body
    :close-on-click-modal="false"
    :title="title"
    top="6vh"
    width="860px"
    @closed="onClosed"
  >
    <el-form
      ref="elForm"
      v-loading="loading"
      class="member-edit-form"
      label-width="100px"
      :model="form"
      :rules="rules"
    >
      <el-row :gutter="16">
        <el-col :span="12">
          <el-form-item :label="$tr('用户名')" prop="userName">
            <el-input
              v-model="form.userName"
              maxlength="30"
              :placeholder="$tr('请输入用户名')"
            />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item :label="$tr('真实名称')" prop="realName">
            <el-input
              v-model="form.realName"
              maxlength="30"
              :placeholder="$tr('请输入真实名称')"
            />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item :label="$tr('邮箱')" prop="email">
            <el-input
              v-model.trim="form.email"
              maxlength="50"
              :placeholder="$tr('请输入邮箱')"
            />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item :label="$tr('头像地址')" prop="avatar">
            <el-input
              v-model.trim="form.avatar"
              maxlength="500"
              :placeholder="$tr('请输入头像地址')"
            />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item :label="$tr('密码')" prop="password">
            <el-input
              v-model="form.password"
              autocomplete="new-password"
              maxlength="50"
              :placeholder="$tr('请输入密码')"
              show-password
              type="password"
            />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item :label="$tr('重复密码')" prop="repassword">
            <el-input
              v-model="form.repassword"
              autocomplete="new-password"
              maxlength="50"
              :placeholder="$tr('请再次输入密码')"
              show-password
              type="password"
            />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item :label="$tr('会员分组')" prop="userGroup">
            <el-select
              v-model="form.userGroup"
              clearable
              :placeholder="$tr('请选择会员分组')"
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
          <el-form-item :label="$tr('角色')" prop="roleId">
            <el-select
              v-model="form.roleId"
              filterable
              :placeholder="$tr('请选择角色（决定登录后菜单权限）')"
            >
              <el-option
                v-for="item in roleOptions"
                :key="item.roleId"
                :label="item.roleName"
                :value="item.roleId"
              />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="24">
          <el-form-item :label="$tr('状态')" prop="userStatus">
            <el-radio-group v-model="form.userStatus">
              <el-radio
                v-for="(key, value) in userStatusOptions"
                :key="value"
                border
                :value="value"
              >
                {{ key }}
              </el-radio>
            </el-radio-group>
          </el-form-item>
        </el-col>
        <el-col :span="24">
          <el-form-item :label="$tr('IP白名单')" prop="ipWhitelist">
            <el-input
              v-model="form.ipWhitelist"
              :placeholder="$tr('留空不限制。每行一条，最多20条')"
              :rows="3"
              type="textarea"
            />
            <div class="ip-whitelist-tip">
              {{ $tr('配置后，该会员每次访问都会校验请求 IP。支持单 IP、网段 192.168.1.0/24、起止段 192.168.1.1-192.168.1.100（可简写 192.168.1.1-100）、通配 10.0.0.*') }}
            </div>
          </el-form-item>
        </el-col>
        <el-col :span="24">
          <el-form-item :label="$tr('个性签名')" prop="personalSignature">
            <el-input
              v-model="form.personalSignature"
              maxlength="500"
              :placeholder="$tr('请输入个性签名')"
              :rows="3"
              show-word-limit
              type="textarea"
            />
          </el-form-item>
        </el-col>
      </el-row>
    </el-form>
    <template #footer>
      <el-button @click="close">{{ $tr('取 消') }}</el-button>
      <el-button :loading="saving" type="primary" @click="save">
        {{ $tr('确 定') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.member-edit-form :deep(.el-form-item__content) {
  flex: 1;
  min-width: 0;
}
.member-edit-form :deep(.el-input),
.member-edit-form :deep(.el-select),
.member-edit-form :deep(.el-input-number) {
  width: 100%;
}
.ip-whitelist-tip {
  margin-top: 6px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.5;
}
</style>
