/**
 * 工具函数
 * 包括 GitHub 内容获取、命令行解析等
 */

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
          const response = await fetch(skillMdUrl, {
            headers: { 'User-Agent': 'skills-sync/1.0' },
          });

          if (response.ok) {
            skillMd = await response.text();
            foundBranch = b;
            foundPath = path || '';
            break;
          }
        } catch {
          // 继续尝试下一个路径或分支
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

    if (skillDir) {
      try {
        const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${skillDir}?ref=${foundBranch}`;
        const response = await fetch(apiUrl, {
          headers: {
            'User-Agent': 'skills-sync/1.0',
            'Accept': 'application/vnd.github.v3+json',
          },
        });

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
                  const contentResponse = await fetch(item.download_url, {
                    headers: { 'User-Agent': 'skills-sync/1.0' },
                  });
                  if (contentResponse.ok) {
                    const content = await contentResponse.text();
                    return { path: item.name, content };
                  }
                } catch {
                  // 忽略单个文件获取错误
                }
              } else if (item.type === 'dir') {
                // 递归获取子目录
                const subFiles = await fetchDirectoryContents(
                  owner, repo, item.path, foundBranch, item.name
                );
                return subFiles;
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
        console.log(`  ⚠️ 获取目录内容失败: ${error.message}`);
      }
    }

    return { skillMd, files };
  } catch (error) {
    console.log(`  ⚠️ 无法获取 GitHub 内容: ${error.message}`);
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
    const response = await fetch(apiUrl, {
      headers: {
        'User-Agent': 'skills-sync/1.0',
        'Accept': 'application/vnd.github.v3+json',
      },
    });

    if (response.ok) {
      const items = await response.json();
      if (Array.isArray(items)) {
        for (const item of items) {
          if (item.type === 'file') {
            try {
              const contentResponse = await fetch(item.download_url, {
                headers: { 'User-Agent': 'skills-sync/1.0' },
              });
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
    }
  }

  return options;
}
