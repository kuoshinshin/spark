const express = require('express');
const InviteCodeController = require('../controllers/inviteCodeController');
const { verifyToken, verifyAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/', verifyToken, verifyAdmin, InviteCodeController.list);
router.post('/', verifyToken, verifyAdmin, InviteCodeController.create);
router.put('/:id', verifyToken, verifyAdmin, InviteCodeController.update);
router.delete('/:id', verifyToken, verifyAdmin, InviteCodeController.remove);

module.exports = router;
