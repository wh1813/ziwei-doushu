import { NextRequest, NextResponse } from 'next/server';

// 获取 Cloudflare D1 绑定实例
function getDb(): any {
  // 1. 优先从 OpenNext 全局 process.env 获取绑定
  const env = (process as any).env;
  if (env?.QUERY_LOGS_DB) {
    return env.QUERY_LOGS_DB;
  }
  // 2. 兼容全局 bindings 注入
  if (typeof (globalThis as any).QUERY_LOGS_DB !== 'undefined') {
    return (globalThis as any).QUERY_LOGS_DB;
  }
  return null;
}

// 获取指定用户的历史手相分析记录
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await params;

    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 }
      );
    }

    const db = getDb();

    if (!db) {
      return NextResponse.json(
        { error: 'Database binding QUERY_LOGS_DB not found' },
        { status: 500 }
      );
    }

    const query = `
      SELECT 
        id,
        user_id,
        image_key,
        image_url,
        extracted_features,
        report_content,
        hand_side,
        created_at
      FROM palm_records
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 50
    `;

    const { results } = await db.prepare(query).bind(userId).all();

    return NextResponse.json({
      success: true,
      data: results || []
    });
  } catch (error: any) {
    console.error('Failed to fetch palm history:', error);
    return NextResponse.json(
      { error: error?.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}

// 删除指定用户的单条或全部手相分析记录
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await params;
    const { searchParams } = new URL(request.url);
    const recordId = searchParams.get('id');

    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 }
      );
    }

    const db = getDb();

    if (!db) {
      return NextResponse.json(
        { error: 'Database binding QUERY_LOGS_DB not found' },
        { status: 500 }
      );
    }

    if (recordId) {
      // 删除单条
      await db
        .prepare('DELETE FROM palm_records WHERE user_id = ? AND id = ?')
        .bind(userId, recordId)
        .run();
    } else {
      // 清空该用户所有记录
      await db
        .prepare('DELETE FROM palm_records WHERE user_id = ?')
        .bind(userId)
        .run();
    }

    return NextResponse.json({
      success: true,
      message: 'Record(s) deleted successfully'
    });
  } catch (error: any) {
    console.error('Failed to delete palm record:', error);
    return NextResponse.json(
      { error: error?.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}
