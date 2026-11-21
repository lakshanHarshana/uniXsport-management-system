const mongoose = require('mongoose');
const dns = require('dns');
try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch(e) {}
const config = require('../server/config');

async function reconcileMongo() {
  console.log('Connecting to MongoDB Atlas...');
  await mongoose.connect(config.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  const db = mongoose.connection.db;
  console.log('Connected to MongoDB Atlas successfully.');

  const equipmentCol = db.collection('equipment');
  const borrowLogsCol = db.collection('borrowLogs');

  const allEquip = await equipmentCol.find({}).toArray();
  const allLogs = await borrowLogsCol.find({}).toArray();

  console.log('Total Equipment in MongoDB:', allEquip.length);
  console.log('Total Borrow Logs in MongoDB:', allLogs.length);

  for (const eq of allEquip) {
    const activeBorrows = allLogs.filter(log =>
      (String(log.equipmentId) === String(eq.id) || String(log.equipmentName || '').toLowerCase() === String(eq.name || '').toLowerCase()) &&
      log.status !== 'returned'
    );

    const trueBorrowed = activeBorrows.reduce((sum, log) => {
      const tot = parseInt(log.qty || log.quantity) || 1;
      const ret = parseInt(log.returnedQty) || 0;
      return sum + Math.max(0, tot - ret);
    }, 0);

    const totalQty = parseInt(eq.totalQty !== undefined ? eq.totalQty : eq.total) || 0;
    const trueAvailable = Math.max(0, totalQty - trueBorrowed);
    const newStatus = (trueAvailable === 0 && trueBorrowed > 0) ? 'borrowed' : (trueAvailable === 0 ? 'out-of-stock' : 'available');

    console.log(`- ${eq.name} (${eq.id}): Total=${totalQty}, Borrowed=${trueBorrowed}, Available=${trueAvailable} (Previous DB Avail: ${eq.availableQty ?? eq.available})`);

    const updateFields = {
      availableQty: trueAvailable,
      available: trueAvailable,
      borrowedQty: trueBorrowed,
      borrowed: trueBorrowed,
      status: newStatus,
      updatedAt: new Date().toISOString()
    };

    await equipmentCol.updateOne(
      { _id: eq._id },
      { $set: updateFields }
    );
  }

  console.log('✓ MongoDB equipment stock successfully reconciled and updated!');
  await mongoose.disconnect();
  process.exit(0);
}

reconcileMongo().catch(err => {
  console.error('Reconciliation error:', err);
  process.exit(1);
});
