-- Manual cleanup script (thay thế event scheduler)
DELETE FROM activity_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL 30 DAY);
