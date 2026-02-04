/**
 * 工具函数
 * 包括 GitHub 内容获取、命令行解析等
 */

import { CONFIG } from './config.js';

/**
 * 带重试的 fetch 函数
 * @param {string} url - 请求 URL
 * @param {Object} options - fetch 选项
 * @param {number} retries - 重试次数
 * @param {number} delay - 重试延迟（毫秒）
 */
async function fetchWithRetry(url, options = {}, retries = 3, delay = 1000) {
  let lastError;

  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);

      // 如果是 403 或 429（速率限制），等待后重试
      if (response.status === 403 || response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : delay * Math.pow(2, i);
        console.log(`  ⏳ 速率限制，等待 ${waitTime / 1000}s 后重试 (${i + 1}/${retries})...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }

      return response;
    } catch (error) {
      lastError = error;
      if (i < retries - 1) {
        console.log(`  ⏳ 请求失败，${delay / 1000}s 后重试 (${i + 1}/${retries})...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  // 如果所有重试都失败，抛出错误
  // 如果 lastError 为 undefined（所有重试都是 403/429 但没有触发 catch），创建一个新的错误
  if (!lastError) {
    throw new Error('GitHub API 速率限制，请配置 GITHUB_TOKEN 以提高限额 (60次/小时 -> 5000次/小时)');
  }
  throw lastError;
}

/**
 * 获取 GitHub API 请求头
 */
function getGithubHeaders(isApi = false) {
  const headers = {
    'User-Agent': 'skills-sync/1.0',
  };

  if (isApi) {
    headers['Accept'] = 'application/vnd.github.v3+json';
  }

  // 如果配置了 GitHub Token，添加认证头
  if (CONFIG.github.token) {
    headers['Authorization'] = `Bearer ${CONFIG.github.token}`;
  }

  return headers;
}

/**
 * 从 GitHub URL 解析仓库信息和路径
 * 支持格式:
 * - https://github.com/owner/repo
 * - https://github.com/owner/repo/tree/branch/path/to/skill
 * - https://github.com/owner/repo/blob/branch/path/to/skill/SKILL.md
 */
function parseGithubUrl(url) {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/').filter(Boolean);

    if (parts.length < 2) return null;

    const owner = parts[0];
    const repo = parts[1];
    let branch = 'main';
    let path = '';

    // 处理 /tree/branch/path 或 /blob/branch/path 格式
    if (parts.length >= 4 && (parts[2] === 'tree' || parts[2] === 'blob')) {
      branch = parts[3];
      path = parts.slice(4).join('/');
      // 如果路径以 SKILL.md 结尾，去掉它（我们会自动添加）
      if (path.endsWith('/SKILL.md')) {
        path = path.slice(0, -9);
      } else if (path.endsWith('SKILL.md')) {
        path = path.slice(0, -8);
      }
    }

    return { owner, repo, branch, path };
  } catch {
    return null;
  }
}

/**
 * 从 GitHub 获取 skill 内容
 * 返回 { skillMd: string, files: Map<string, string> }
 */
export async function fetchGithubContent(features) {
  try {
    const repoInfo = parseGithubUrl(features.sourceUrl);
    if (!repoInfo) return null;

    const { owner, repo, branch, path } = repoInfo;

    // 构建可能的 SKILL.md 路径
    const branches = ['main', 'master'];
    const pathsToTry = path ? [`${path}/SKILL.md`] : ['SKILL.md'];

    // 如果解析到特定分支，优先尝试该分支
    if (branch && branch !== 'main' && branch !== 'master') {
      branches.unshift(branch);
    }

    let skillMd = null;
    let foundBranch = 'main';
    let foundPath = '';

    // 第一步：找到 SKILL.md
    for (const b of branches) {
      for (const p of pathsToTry) {
        try {
          const skillMdUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${b}/${p}`;
          const response = await fetchWithRetry(skillMdUrl, {
            headers: getGithubHeaders(false),
          }, 3, 1000);

          if (response.ok) {
            skillMd = await response.text();
            foundBranch = b;
            foundPath = path || '';
            break;
          }
        } catch (error) {
          // 继续尝试下一个路径或分支
          const errorMsg = error?.message || String(error);
          if (!errorMsg.includes('fetch failed')) {
            console.log(`  ⚠️ 获取 SKILL.md 失败: ${errorMsg}`);
          }
        }
      }
      if (skillMd) break;
    }

    if (!skillMd) {
      return null;
    }

    // 第二步：获取该目录下的所有其他文件
    const files = new Map();
    const skillDir = foundPath;

    let fetchErrors = [];

    if (skillDir) {
      try {
        const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${skillDir}?ref=${foundBranch}`;
        const response = await fetchWithRetry(apiUrl, {
          headers: getGithubHeaders(true),
        }, 3, 1000);

        if (response.ok) {
          const items = await response.json();
          if (Array.isArray(items)) {
            // 递归获取所有文件
            const filePromises = items.map(async (item) => {
              if (item.type === 'file') {
                // 跳过 SKILL.md（已经获取过了）
                if (item.name.toLowerCase() === 'skill.md') {
                  return null;
                }
                try {
                  const contentResponse = await fetchWithRetry(item.download_url, {
                    headers: getGithubHeaders(false),
                  }, 2, 500);
                  if (contentResponse.ok) {
                    const content = await contentResponse.text();
                    return { path: item.name, content };
                  }
                } catch (error) {
                  // 记录文件获取错误
                  fetchErrors.push({ type: 'file', path: item.name, error: error.message });
                }
              } else if (item.type === 'dir') {
                // 递归获取子目录
                const subFiles = await fetchDirectoryContents(
                  owner, repo, item.path, foundBranch, item.name
                );
                return subFiles;
              } else if (item.type === 'symlink') {
                // 处理符号链接 - 获取链接指向的实际内容
                console.log(`  🔗 发现符号链接: ${item.name}`);
                try {
                  // 首先获取符号链接文件本身的内容（即目标路径）
                  const linkResponse = await fetch(item.download_url, {
                    headers: { 'User-Agent': 'skills-sync/1.0' },
                  });
                  if (!linkResponse.ok) {
                    console.log(`  ⚠️ 无法读取符号链接: ${item.name}`);
                    return null;
                  }
                  const targetPath = (await linkResponse.text()).trim();
                  console.log(`  📍 链接目标: ${targetPath}`);

                  // 计算目标路径的绝对路径（相对于仓库根目录）
                  const currentDir = item.path.substring(0, item.path.lastIndexOf('/'));
                  let resolvedPath;
                  if (targetPath.startsWith('/')) {
                    // 绝对路径（从仓库根目录开始）
                    resolvedPath = targetPath.substring(1);
                  } else if (targetPath.startsWith('./')) {
                    // 相对当前目录
                    resolvedPath = `${currentDir}/${targetPath.substring(2)}`;
                  } else if (targetPath.startsWith('../')) {
                    // 相对上级目录，需要解析 ..
                    const parts = currentDir.split('/');
                    const targetParts = targetPath.split('/');
                    for (const part of targetParts) {
                      if (part === '..') {
                        parts.pop();
                      } else if (part !== '.' && part !== '') {
                        parts.push(part);
                      }
                    }
                    resolvedPath = parts.join('/');
                  } else {
                    // 普通相对路径
                    resolvedPath = `${currentDir}/${targetPath}`;
                  }
                  console.log(`  📂 解析路径: ${resolvedPath}`);

                  // 尝试获取目标路径的内容
                  // 首先尝试作为目录
                  const subFiles = await fetchDirectoryContents(
                    owner, repo, resolvedPath, foundBranch, item.name
                  );
                  if (subFiles.length > 0) {
                    console.log(`  ✅ 获取目录内容: ${subFiles.length} 个文件`);
                    return subFiles;
                  }

                  // 尝试作为文件
                  const targetUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${foundBranch}/${resolvedPath}`;
                  const contentResponse = await fetch(targetUrl, {
                    headers: { 'User-Agent': 'skills-sync/1.0' },
                  });
                  if (contentResponse.ok) {
                    const content = await contentResponse.text();
                    console.log(`  ✅ 获取文件内容: ${content.length} 字节`);
                    return { path: item.name, content };
                  }

                  console.log(`  ⚠️ 无法获取链接目标: ${resolvedPath}`);
                } catch (error) {
                  console.log(`  ⚠️ 无法获取符号链接内容: ${item.name} - ${error.message}`);
                }
                return null;
              }
              return null;
            });

            const results = await Promise.all(filePromises);
            for (const result of results) {
              if (result) {
                if (Array.isArray(result)) {
                  // 子目录返回的是文件数组
                  for (const file of result) {
                    files.set(file.path, file.content);
                  }
                } else {
                  files.set(result.path, result.content);
                }
              }
            }
          }
        }
      } catch (error) {
        const errorMsg = error?.message || String(error);
        console.log(`  ⚠️ 获取目录内容失败: ${errorMsg}`);
      }
    }

    return { skillMd, files };
  } catch (error) {
    const errorMsg = error?.message || String(error);
    console.log(`  ⚠️ 无法获取 GitHub 内容: ${errorMsg}`);
    return null;
  }
}

/**
 * 递归获取目录内容
 */
async function fetchDirectoryContents(owner, repo, dirPath, branch, basePath) {
  const files = [];
  try {
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${dirPath}?ref=${branch}`;
    const response = await fetchWithRetry(apiUrl, {
      headers: getGithubHeaders(true),
    }, 3, 1000);

    if (response.ok) {
      const items = await response.json();
      if (Array.isArray(items)) {
        for (const item of items) {
          if (item.type === 'file') {
            try {
              const contentResponse = await fetchWithRetry(item.download_url, {
                headers: getGithubHeaders(false),
              }, 2, 500);
              if (contentResponse.ok) {
                const content = await contentResponse.text();
                files.push({ path: `${basePath}/${item.name}`, content });
              }
            } catch {
              // 忽略单个文件获取错误
            }
          } else if (item.type === 'dir') {
            // 递归获取子目录
            const subFiles = await fetchDirectoryContents(
              owner, repo, item.path, branch, `${basePath}/${item.name}`
            );
            files.push(...subFiles);
          } else if (item.type === 'symlink') {
            // 处理符号链接
            console.log(`  🔗 发现符号链接: ${item.name}`);
            try {
              // 首先获取符号链接文件本身的内容（即目标路径）
              const linkResponse = await fetchWithRetry(item.download_url, {
                headers: getGithubHeaders(false),
              }, 2, 500);
              if (!linkResponse.ok) {
                console.log(`  ⚠️ 无法读取符号链接: ${item.name}`);
                continue;
              }
              const targetPath = (await linkResponse.text()).trim();
              console.log(`  📍 链接目标: ${targetPath}`);

              // 计算目标路径的绝对路径
              const currentDir = item.path.substring(0, item.path.lastIndexOf('/'));
              let resolvedPath;
              if (targetPath.startsWith('/')) {
                resolvedPath = targetPath.substring(1);
              } else if (targetPath.startsWith('./')) {
                resolvedPath = `${currentDir}/${targetPath.substring(2)}`;
              } else if (targetPath.startsWith('../')) {
                const parts = currentDir.split('/');
                const targetParts = targetPath.split('/');
                for (const part of targetParts) {
                  if (part === '..') {
                    parts.pop();
                  } else if (part !== '.' && part !== '') {
                    parts.push(part);
                  }
                }
                resolvedPath = parts.join('/');
              } else {
                resolvedPath = `${currentDir}/${targetPath}`;
              }
              console.log(`  📂 解析路径: ${resolvedPath}`);

              // 尝试获取目标目录内容
              const subFiles = await fetchDirectoryContents(
                owner, repo, resolvedPath, branch, `${basePath}/${item.name}`
              );
              if (subFiles.length > 0) {
                console.log(`  ✅ 获取目录内容: ${subFiles.length} 个文件`);
                files.push(...subFiles);
                continue;
              }

              // 尝试作为文件
              const targetUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${resolvedPath}`;
              const contentResponse = await fetchWithRetry(targetUrl, {
                headers: getGithubHeaders(false),
              }, 2, 500);
              if (contentResponse.ok) {
                const content = await contentResponse.text();
                console.log(`  ✅ 获取文件内容: ${content.length} 字节`);
                files.push({ path: `${basePath}/${item.name}`, content });
              }
            } catch (error) {
              console.log(`  ⚠️ 无法获取符号链接内容: ${item.name} - ${error.message}`);
            }
          }
        }
      }
    }
  } catch {
    // 忽略目录获取错误
  }
  return files;
}

/**
 * 解析命令行参数
 */
export function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    mode: 'batch',
    names: [],
    limit: 20,
    sortBy: 'stars',
    useAiSearch: false,
    forceUpdate: false,
    nonInteractive: false,
    conflictStrategy: 'skip', // 'skip' | 'replace' | 'keep-both'
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--names':
        options.mode = 'names';
        while (i + 1 < args.length && !args[i + 1].startsWith('--')) {
          options.names.push(args[++i]);
        }
        break;
      case '--mode':
        options.mode = args[++i];
        break;
      case '--limit':
        options.limit = parseInt(args[++i], 10) || 20;
        break;
      case '--sort':
        options.sortBy = args[++i] || 'stars';
        break;
      case '--use-ai-search':
        options.useAiSearch = true;
        break;
      case '--force':
        options.forceUpdate = true;
        break;
      case '--non-interactive':
        options.nonInteractive = true;
        break;
      case '--conflict-strategy':
        const strategy = args[++i];
        if (['skip', 'replace', 'keep-both'].includes(strategy)) {
          options.conflictStrategy = strategy;
        }
        break;
    }
  }

  return options;
}
