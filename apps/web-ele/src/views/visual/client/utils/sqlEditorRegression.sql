-- SQL 编辑器回归用例（MySQL，可重复执行）
--
-- 手工：把本文件贴进 SQL 编辑器，光标放到带 /*cursor:...*/ 的语句上再执行。
-- 自动：在 vue-vben-admin 根目录执行
--   pnpm exec vitest run apps/web-ele/src/views/visual/client/utils/sqlEditorRegression.test.ts --dom
--
-- 只动表 lm_editor_regression 和过程 lm_editor_regression_proc，跑完最后两句会删掉。

DROP TABLE IF EXISTS lm_editor_regression;

CREATE TABLE lm_editor_regression (
  id BIGINT NOT NULL PRIMARY KEY,
  code VARCHAR(64) NOT NULL,
  note VARCHAR(255) NULL
);

-- 1) 光标在这条 INSERT 上：应连同上面两条 SET 一起执行，插入 code=chain
SET @note := 'from-set';
SET @new_id := (SELECT IFNULL(MAX(id), 0) + 1 FROM lm_editor_regression);
INSERT /*cursor:chain*/ INTO lm_editor_regression (id, code, note)
SELECT @new_id, 'chain', @note FROM DUAL
WHERE @note IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM lm_editor_regression WHERE code = 'chain');

-- 2) 光标在最后这条 INSERT 上：要带上 @keep 和 @row_id，中间的 seed 插入不要再执行
SET @keep := 'kept';
INSERT INTO lm_editor_regression (id, code, note)
SELECT 10, 'seed', 'unrelated' FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM lm_editor_regression WHERE id = 10);
SET @row_id := (SELECT IFNULL(MAX(id), 0) + 1 FROM lm_editor_regression);
INSERT /*cursor:gap*/ INTO lm_editor_regression (id, code, note)
SELECT @row_id, 'gap', @keep FROM DUAL
WHERE @keep IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM lm_editor_regression WHERE code = 'gap');

-- 3) 光标在 SET NAMES 上：不要把后面的查询一起执行
SET NAMES utf8mb4;
SELECT /*cursor:after-names*/ code, note FROM lm_editor_regression WHERE code = 'chain';

-- 4) 光标在 END IF 上：整段过程是一条，后面的 CALL 单独执行
DELIMITER $$
CREATE PROCEDURE lm_editor_regression_proc()
BEGIN
  IF (SELECT COUNT(*) FROM lm_editor_regression WHERE code = 'proc') = 0 THEN
    INSERT INTO lm_editor_regression (id, code, note)
    VALUES (20, 'proc', 'in-proc');
  END IF; /*cursor:proc*/
END$$
DELIMITER ;

CALL lm_editor_regression_proc();

-- 5) 光标在 EXECUTE 上：SET、PREPARE、EXECUTE、DEALLOCATE 共用一次会话
SET @prep_sql := 'INSERT INTO lm_editor_regression (id, code, note) SELECT 30, ''prep'', ''ok'' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM lm_editor_regression WHERE id = 30)';
PREPARE lm_editor_stmt FROM @prep_sql;
EXECUTE /*cursor:exec*/ lm_editor_stmt;
DEALLOCATE PREPARE lm_editor_stmt;

-- 6) 光标放在清理语句上时，只删除对象，不要把前面的插入再跑一遍
DROP PROCEDURE IF EXISTS lm_editor_regression_proc;
DROP /*cursor:cleanup*/ TABLE IF EXISTS lm_editor_regression;
