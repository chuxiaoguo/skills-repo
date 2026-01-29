/**
 * 配置文件
 * 支持从环境变量读取配置
 */
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../..');

// 加载 .env 文件
config({ path: path.join(ROOT_DIR, '.env') });

export const CONFIG = {
  // skillsmp.com API 配置
  skillsmp: {
    baseUrl: process.env.SKILLSMP_BASE_URL || 'https://skillsmp.com/api/v1',
    token: process.env.SKILLSMP_API_TOKEN,
  },
  // 路径配置
  paths: {
    root: ROOT_DIR,
    skillsDir: path.join(ROOT_DIR, 'skills-json'),
    skillsJson: path.join(ROOT_DIR, 'skills.json'),
    skillsCollection: path.join(ROOT_DIR, 'skills-collection'),
  },
  // 同步参数
  sync: {
    concurrency: 3,
    defaultLimit: 20,
    maxPerPage: 100,
  },
};

// 验证必要配置
export function validateConfig() {
  if (!CONFIG.skillsmp.token) {
    throw new Error(
      'SKILLSMP_API_TOKEN 未设置。请复制 .env.example 为 .env 并填写你的 API Token。'
    );
  }
}
