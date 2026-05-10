import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function seed() {
  const client = await pool.connect();
  try {
    const existingSlots = await client.query('SELECT COUNT(*) FROM wheel_slots');
    if (parseInt(existingSlots.rows[0].count) === 0) {
      console.log('Seeding wheel slots...');
      await client.query(`
        INSERT INTO wheel_slots (amount, probability, display_order) VALUES
        (0.05, 35, 1),
        (0.10, 25, 2),
        (0.25, 18, 3),
        (0.50, 10, 4),
        (0.75, 5, 5),
        (1.00, 3, 6),
        (1.50, 2, 7),
        (2.00, 1, 8),
        (3.00, 1, 9),
        (4.00, 0, 10)
      `);
      console.log('Wheel slots seeded!');
    } else {
      console.log('Wheel slots already exist.');
    }

    const existingTasks = await client.query('SELECT COUNT(*) FROM tasks');
    if (parseInt(existingTasks.rows[0].count) === 0) {
      console.log('Seeding tasks...');
      await client.query(`
        INSERT INTO tasks (title, description, url, icon, is_active) VALUES
        ('انضم لقناتنا على تيليغرام', 'اشترك في قناتنا الرسمية واحصل على آخر الأخبار', 'https://t.me/jojoxchannel', '📢', true),
        ('ادعُ صديقاً واحداً', 'أرسل رابط الإحالة لصديق وانتظر تسجيله', NULL, '👥', true),
        ('شارك البوت مع 3 أصدقاء', 'أرسل رابط البوت لـ 3 أصدقاء على الأقل', NULL, '🔗', true),
        ('تابعنا على تويتر X', 'تابع حسابنا الرسمي على منصة X', 'https://x.com/jojoxofficial', '🐦', true),
        ('العب عجلة الحظ لأول مرة', 'قم بتدوير العجلة للحصول على مكافأة الترحيب', NULL, '🎡', true)
      `);
      console.log('Tasks seeded!');
    } else {
      console.log('Tasks already exist.');
    }

    console.log('Seed complete!');
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(console.error);
