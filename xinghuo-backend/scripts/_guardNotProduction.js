/**
 * 造数/回退/手工改库类脚本：生产环境禁止执行，防止误操作污染线上数据。
 * 若确需在维护窗口执行，可临时设置 ALLOW_DANGEROUS_DB_SCRIPTS=1（仍不建议）。
 */
function guardNotProduction(scriptName) {
  const allow = String(process.env.ALLOW_DANGEROUS_DB_SCRIPTS || '').trim() === '1';
  if (allow) return;
  if (process.env.NODE_ENV === 'production') {
    console.error(
      `[${scriptName}] 已阻止：生产环境 (NODE_ENV=production) 禁止执行该脚本。` +
        ' 维护需要时请改用受控迁移或临时设置 ALLOW_DANGEROUS_DB_SCRIPTS=1（风险自负）。'
    );
    process.exit(1);
  }
}

module.exports = { guardNotProduction };
