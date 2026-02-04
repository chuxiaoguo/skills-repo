#!/usr/bin/env node
/**
 * 根据配置文件同步指定技能
 * 从 config-skills.json 读取配置并同步技能
 *
 * 使用方法:
 *   npm run skills:sync:config           # 使用默认配置文件
 *   npm run skills:sync:config -- --file custom.json  # 指定其他配置文件
 */

import { CONFIG, validateConfig } from './lib/config.js';
import { SyncController } from './lib/sync-controller.js';
import fs from 'fs/promises';
import path from 'path';

const DEFAULT_CONFIG_FILE = 'config-skills.json';

/**
 * 解析命令行参数
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    configFile: DEFAULT_CONFIG_FILE,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--file' || arg === '-f') {
      result.configFile = args[++i];
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
使用方法: npm run skills:sync:config [选项]

选项:
  -f, --file <file>  指定配置文件路径 (默认: config-skills.json)
  -h, --help         显示帮助信息

示例:
  npm run skills:sync:config
  npm run skills:sync:config -- --file my-skills.json
`);
      process.exit(0);
    }
  }

  return result;
}

/**
 * 加载用户配置文件
 */
async function loadUserConfig(configFile) {
  const configPath = path.join(CONFIG.paths.root, configFile);
  try {
    const content = await fs.readFile(configPath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.error(`❌ 配置文件不存在: ${configFile}`);
      console.log(`\n请创建配置文件: ${configFile}`);
      console.log('参考示例:');
      console.log(JSON.stringify({
        description: "我的自定义技能列表配置",
        skills: ["pr-creator", "code-reviewer", "docs-writer"],
        options: {
          useAiSearch: false,
          autoMerge: true
        }
      }, null, 2));
    } else {
      console.error(`❌ 无法读取配置文件 ${configFile}:`, error.message);
    }
    process.exit(1);
  }
}

/**
 * 验证配置
 */
function validateUserConfig(config, configFile) {
  if (!config.skills) {
    console.error(`❌ 配置文件 ${configFile} 缺少 "skills" 字段`);
    process.exit(1);
  }

  if (!Array.isArray(config.skills)) {
    console.error(`❌ 配置文件 ${configFile} 的 "skills" 必须是数组`);
    process.exit(1);
  }

  if (config.skills.length === 0) {
    console.error(`❌ 配置文件 ${configFile} 中没有指定技能`);
    process.exit(1);
  }

  // 过滤空字符串
  const validSkills = config.skills.filter(name => typeof name === 'string' && name.trim() !== '');

  if (validSkills.length === 0) {
    console.error(`❌ 配置文件 ${configFile} 中没有有效的技能名称`);
    process.exit(1);
  }

  return validSkills;
}

async function main() {
  console.log('🚀 配置化 Skills 同步工具\n');

  const args = parseArgs();

  // 验证环境配置
  try {
    validateConfig();
  } catch (error) {
    console.error('❌ 配置错误:', error.message);
    console.log('\n请执行以下步骤:');
    console.log('  1. cp .env.example .env');
    console.log('  2. 编辑 .env 文件，填写你的 SKILLSMP_API_TOKEN');
    process.exit(1);
  }

  // 加载用户配置
  const userConfig = await loadUserConfig(args.configFile);
  const validSkills = validateUserConfig(userConfig, args.configFile);
  const options = userConfig.options || {};

  if (userConfig.description) {
    console.log(`📝 ${userConfig.description}\n`);
  }

  console.log(`📋 配置中共有 ${validSkills.length} 个技能:`);
  validSkills.forEach(name => console.log(`   • ${name}`));
  console.log();

  const controller = new SyncController(CONFIG, {
    nonInteractive: options.autoSelect === true,
  });

  try {
    const results = await controller.syncByNames(validSkills, {
      useAiSearch: options.useAiSearch ?? false,
    });

    // 自动合并到 skills.json
    if (results.length > 0 && options.autoMerge !== false) {
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
