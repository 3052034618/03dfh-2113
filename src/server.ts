import app, { initializeApp } from './app';

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

async function startServer() {
  try {
    console.log('🚀 正在启动剧本杀排位规则服务...');
    console.log('📦 正在初始化数据库...');

    await initializeApp();

    app.listen(PORT, () => {
      console.log('✅ 数据库初始化完成');
      console.log('');
      console.log(`📡 服务地址: http://localhost:${PORT}`);
      console.log(`💡 健康检查: http://localhost:${PORT}/health`);
      console.log('');
      console.log('📋 API 概览:');
      console.log('   - 规则管理:   GET/POST/PUT/DELETE /api/rules');
      console.log('   - 门店管理:   GET/POST/PUT/DELETE /api/stores');
      console.log('   - 剧本管理:   GET/POST/PUT/DELETE /api/scripts');
      console.log('   - 角色分配:   POST /api/allocations/allocate');
      console.log('   - 数据统计:   GET /api/stats/summary');
      console.log('');
      console.log('💡 提示: 运行 npm run seed 可导入示例数据');
    });
  } catch (err) {
    console.error('❌ 服务启动失败:', err);
    process.exit(1);
  }
}

startServer();
