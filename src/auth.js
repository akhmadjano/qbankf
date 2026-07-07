const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-in-env';

function signAdminToken(admin) {
  return jwt.sign({ type: 'admin', id: admin.id, username: admin.username }, JWT_SECRET, { expiresIn: '7d' });
}

function signStudentToken(student) {
  return jwt.sign(
    { type: 'student', id: student.id, telegram_id: student.telegram_id },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

function signDeveloperToken(dev) {
  return jwt.sign({ type: 'developer', id: dev.id, email: dev.email }, JWT_SECRET, { expiresIn: '7d' });
}

function authMiddleware(requiredType) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Token topilmadi' });
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      if (requiredType && payload.type !== requiredType) {
        return res.status(403).json({ error: 'Ruxsat yo\'q' });
      }
      req.auth = payload;
      next();
    } catch (e) {
      return res.status(401).json({ error: 'Token yaroqsiz yoki muddati o\'tgan' });
    }
  };
}

module.exports = {
  signAdminToken,
  signStudentToken,
  signDeveloperToken,
  requireAdmin: authMiddleware('admin'),
  requireStudent: authMiddleware('student'),
  requireDeveloper: authMiddleware('developer'),
};
