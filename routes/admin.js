import { Router } from 'express';

const router = Router();

router.get('/', (req, res) => {
  res.redirect('/admin/dashboard');
});

router.get('/dashboard', (req, res) => {
  res.render('admin/dashboard', { title: 'Admin Dashboard' });
});

export default router;
