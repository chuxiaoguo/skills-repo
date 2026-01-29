#!/usr/bin/env node
/**
 * Skills 合并脚本
 * 将 skills/ 目录下的所有单技能 JSON 文件合并到 skills.json
 *
 * 使用方法:
 *   node scripts/merge-skills.js              # 合并所有 skills
 *   node scripts/merge-skills.js --verbose    # 显示详细信息
 *   node scripts/merge-skills.js --dry-run    # 试运行（不写入文件）
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

const SKILLS_DIR = path.join(ROOT_DIR, 'skills');
const SKILLS_JSON_PATH = path.join(ROOT_DIR, 'skills.json');

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    verbose: args.includes('--verbose') || args.includes('-v'),
    dryRun: args.includes('--dry-run') || args.includes('-d'),
  };
}

async function ensureDir(dir) {
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
  }
}

async function mergeSkills(options = {}) {
  const { verbose, dryRun } = options;

  console.log('🔄 合并 Skills...\n');

  // 确保目录存在
  await ensureDir(SKILLS_DIR);

  // 读取所有单技能 JSON 文件
  const entries = await fs.readdir(SKILLS_DIR, { withFileTypes: true });
  const skills = [];
  const errors = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;

    const skillName = entry.name.replace('.json', '');
    const filePath = path.join(SKILLS_DIR, entry.name);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const skill = JSON.parse(content);

      // 验证必要字段
      if (!skill.name) {
        errors.push({ file: entry.name, error: '缺少 name 字段' });
        continue;
      }

      skills.push(skill);

      if (verbose) {
        console.log(`  ✓ ${skill.name}`);
      }
    } catch (error) {
      errors.push({ file: entry.name, error: error.message });
      console.warn(`  ⚠️ 解析失败: ${entry.name}`);
    }
  }

  // 按名称排序
  skills.sort((a, b) => a.name.localeCompare(b.name));

  console.log(`\n📊 统计:`);
  console.log(`  - 成功读取: ${skills.length} 个 skills`);
  if (errors.length > 0) {
    console.log(`  - 读取失败: ${errors.length} 个`);
  }

  // 构建最终的 skills.json
  const data = {
    meta: {
      generatedAt: new Date().toISOString(),
      total: skills.length,
    },
    skills,
  };

  // 输出预览
  if (verbose) {
    console.log('\n📋 预览:');
    console.log(JSON.stringify(data, null, 2).substring(0, 1000) + '...');
  }

  if (dryRun) {
    console.log('\n⏭️  试运行模式，未写入文件');
    return { skills, dryRun: true };
  }

  // 写入文件
  await fs.writeFile(SKILLS_JSON_PATH, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`\n✅ 已写入: ${SKILLS_JSON_PATH}`);

  return { skills, errors };
}

async function main() {
  const options = parseArgs();

  try {
    const result = await mergeSkills(options);

    if (result.errors?.length > 0) {
      console.log('\n⚠️  警告: 以下文件处理失败:');
      result.errors.forEach(({ file, error }) => {
        console.log(`  - ${file}: ${error}`);
      });
    }

    console.log('\n✅ 合并完成!');
  } catch (error) {
    console.error('\n❌ 合并失败:', error.message);
    process.exit(1);
  }
}

main();
