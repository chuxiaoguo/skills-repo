#!/usr/bin/env node
/**
 * Skills 同步脚本
 * 从 skillsmp.com API 同步 skills
 *
 * 使用方法:
 *   npm run skills:sync -- --names "skill-a" "skill-b"    # 按名字同步
 *   npm run skills:sync -- --limit 50 --sort stars       # 批量同步热门 skills
 *   npm run skills:sync -- --names "react" --force       # 强制更新（忽略缓存）
 */

import { CONFIG, validateConfig } from './lib/config.js';
import { SyncController } from './lib/sync-controller.js';
import { parseArgs } from './lib/utils.js';

async function main() {
  console.log('🚀 Skills Sync Tool\n');

  // 验证配置
  try {
    validateConfig();
  } catch (error) {
    console.error('❌ 配置错误:', error.message);
    console.log('\n请执行以下步骤:');
    console.log('  1. cp .env.example .env');
    console.log('  2. 编辑 .env 文件，填写你的 SKILLSMP_API_TOKEN');
    process.exit(1);
  }

  const args = parseArgs();
  const controller = new SyncController(CONFIG);

  try {
    let results;

    if (args.mode === 'names') {
      if (args.names.length === 0) {
        console.error('❌ 请提供要同步的 skill 名字: --names "skill-a" "skill-b"');
        process.exit(1);
      }
      results = await controller.syncByNames(args.names, {
        useAiSearch: args.useAiSearch,
      });
    } else {
      results = await controller.syncBatch(args.limit, args.sortBy);
    }

    // 合并到 skills.json
    if (results.length > 0) {
      console.log('\n📝 更新 skills.json...');
      await controller.writer.mergeSkillsFromDir();
      console.log('  ✅ 已更新');
    }

    controller.printStats();
    console.log('\n✅ 同步完成!');
  } catch (error) {
    console.error('\n❌ 同步失败:', error.message);
    process.exit(1);
  }
}

main();
