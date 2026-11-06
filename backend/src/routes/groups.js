import { Router } from 'express'
import { getPool } from '../db.js'

const router = Router()

async function assertGroupOwnership(db, groupId, ownerId) {
  const res = await db.query(
    'SELECT id FROM public.groups WHERE id = $1 AND owner_id = $2',
    [groupId, ownerId]
  )
  return res.rows.length > 0
}

/**
 * Arma los grupos del usuario autenticado con sus miembros, transacciones y divisiones (splits).
 */
export async function fetchGroups(db, ownerId, singleGroupId = null) {
  const params = singleGroupId ? [ownerId, singleGroupId] : [ownerId]
  const whereClause = singleGroupId
    ? 'WHERE owner_id = $1 AND id = $2'
    : 'WHERE owner_id = $1'

  const groupsRes = await db.query(
    `SELECT id, name, created_at FROM public.groups ${whereClause} ORDER BY created_at DESC`,
    params
  )

  if (groupsRes.rows.length === 0) return []

  const groupIds = groupsRes.rows.map((g) => g.id)

  const membersRes = await db.query(
    `SELECT id, group_id, name FROM public.members WHERE group_id = ANY($1::uuid[]) ORDER BY created_at ASC`,
    [groupIds]
  )

  const txRes = await db.query(
    `SELECT id, group_id, type, description, amount, paid_by, split_mode, from_member_id, to_member_id, created_at
     FROM public.transactions
     WHERE group_id = ANY($1::uuid[])
     ORDER BY created_at DESC`,
    [groupIds]
  )

  const txIds = txRes.rows.map((t) => t.id)
  let splitsRows = []
  if (txIds.length > 0) {
    const splitsRes = await db.query(
      `SELECT transaction_id, member_id, amount
       FROM public.transaction_splits
       WHERE transaction_id = ANY($1::uuid[])`,
      [txIds]
    )
    splitsRows = splitsRes.rows
  }

  const splitsByTx = new Map()
  for (const s of splitsRows) {
    if (!splitsByTx.has(s.transaction_id)) {
      splitsByTx.set(s.transaction_id, [])
    }
    splitsByTx.get(s.transaction_id).push({
      memberId: s.member_id,
      amount: Number(s.amount),
    })
  }

  const membersByGroup = new Map()
  for (const m of membersRes.rows) {
    if (!membersByGroup.has(m.group_id)) {
      membersByGroup.set(m.group_id, [])
    }
    membersByGroup.get(m.group_id).push({
      id: m.id,
      name: m.name,
    })
  }

  const txByGroup = new Map()
  for (const t of txRes.rows) {
    if (!txByGroup.has(t.group_id)) {
      txByGroup.set(t.group_id, [])
    }
    const baseTx = {
      id: t.id,
      type: t.type,
      amount: Number(t.amount),
      createdAt: t.created_at,
    }
    if (t.type === 'expense') {
      txByGroup.get(t.group_id).push({
        ...baseTx,
        description: t.description,
        paidBy: t.paid_by,
        splitMode: t.split_mode,
        splits: splitsByTx.get(t.id) || [],
      })
    } else {
      txByGroup.get(t.group_id).push({
        ...baseTx,
        from: t.from_member_id,
        to: t.to_member_id,
      })
    }
  }

  return groupsRes.rows.map((g) => ({
    id: g.id,
    name: g.name,
    createdAt: g.created_at,
    members: membersByGroup.get(g.id) || [],
    transactions: txByGroup.get(g.id) || [],
  }))
}

// GET /api/groups — Listar los grupos del usuario autenticado
router.get('/', async (req, res, next) => {
  try {
    const pool = await getPool()
    const groups = await fetchGroups(pool, req.user.id)
    res.json(groups)
  } catch (err) {
    next(err)
  }
})

// POST /api/groups — Crear un grupo con miembros iniciales opcionales
router.post('/', async (req, res, next) => {
  let client
  try {
    const { name, memberNames = [] } = req.body
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'El nombre del grupo es obligatorio.' })
    }

    const pool = await getPool()
    client = await pool.connect()
    await client.query('BEGIN')

    const groupRes = await client.query(
      'INSERT INTO public.groups (owner_id, name) VALUES ($1, $2) RETURNING id',
      [req.user.id, name.trim()]
    )
    const groupId = groupRes.rows[0].id

    for (const rawName of memberNames) {
      const cleanName = String(rawName || '').trim()
      if (cleanName) {
        await client.query(
          'INSERT INTO public.members (group_id, name) VALUES ($1, $2)',
          [groupId, cleanName]
        )
      }
    }

    await client.query('COMMIT')
    const [createdGroup] = await fetchGroups(pool, req.user.id, groupId)
    res.status(201).json(createdGroup)
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {})
    next(err)
  } finally {
    if (client) client.release()
  }
})

// DELETE /api/groups/:groupId — Eliminar un grupo propio
router.delete('/:groupId', async (req, res, next) => {
  try {
    const pool = await getPool()
    const deleted = await pool.query(
      'DELETE FROM public.groups WHERE id = $1 AND owner_id = $2 RETURNING id',
      [req.params.groupId, req.user.id]
    )
    if (deleted.rows.length === 0) {
      return res.status(404).json({ error: 'Grupo no encontrado.' })
    }
    const groups = await fetchGroups(pool, req.user.id)
    res.json(groups)
  } catch (err) {
    next(err)
  }
})

// POST /api/groups/:groupId/members — Agregar un amigo al grupo propio
router.post('/:groupId/members', async (req, res, next) => {
  try {
    const { name } = req.body
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'El nombre del amigo es obligatorio.' })
    }

    const pool = await getPool()
    const isOwner = await assertGroupOwnership(pool, req.params.groupId, req.user.id)
    if (!isOwner) {
      return res.status(404).json({ error: 'Grupo no encontrado.' })
    }

    await pool.query(
      'INSERT INTO public.members (group_id, name) VALUES ($1, $2)',
      [req.params.groupId, name.trim()]
    )

    const [updatedGroup] = await fetchGroups(pool, req.user.id, req.params.groupId)
    res.status(201).json(updatedGroup)
  } catch (err) {
    next(err)
  }
})

// POST /api/groups/:groupId/expenses — Registrar un gasto y su división de cuenta
router.post('/:groupId/expenses', async (req, res, next) => {
  let client
  try {
    const { description, amount, paidBy, splitMode, splits } = req.body
    const numericAmount = Number(amount)

    if (!description || !description.trim()) {
      return res.status(400).json({ error: 'La descripción es obligatoria.' })
    }
    if (!numericAmount || numericAmount <= 0) {
      return res.status(400).json({ error: 'El monto debe ser mayor a 0.' })
    }
    if (!paidBy || !Array.isArray(splits) || splits.length === 0) {
      return res.status(400).json({ error: 'Datos de pago o división incompletos.' })
    }

    const pool = await getPool()
    client = await pool.connect()
    await client.query('BEGIN')

    const isOwner = await assertGroupOwnership(client, req.params.groupId, req.user.id)
    if (!isOwner) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'Grupo no encontrado.' })
    }

    const txRes = await client.query(
      `INSERT INTO public.transactions (group_id, type, description, amount, paid_by, split_mode)
       VALUES ($1, 'expense', $2, $3, $4, $5)
       RETURNING id`,
      [
        req.params.groupId,
        description.trim(),
        numericAmount,
        paidBy,
        splitMode === 'exact' ? 'exact' : 'equal',
      ]
    )
    const txId = txRes.rows[0].id

    for (const s of splits) {
      await client.query(
        `INSERT INTO public.transaction_splits (transaction_id, member_id, amount)
         VALUES ($1, $2, $3)`,
        [txId, s.memberId, Number(s.amount)]
      )
    }

    await client.query('COMMIT')
    const [updatedGroup] = await fetchGroups(pool, req.user.id, req.params.groupId)
    res.status(201).json(updatedGroup)
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {})
    next(err)
  } finally {
    if (client) client.release()
  }
})

// POST /api/groups/:groupId/settlements — Liquidar deuda entre dos amigos
router.post('/:groupId/settlements', async (req, res, next) => {
  try {
    const { from, to, amount } = req.body
    const numericAmount = Number(amount)

    if (!from || !to || !numericAmount || numericAmount <= 0) {
      return res.status(400).json({ error: 'Datos de liquidación inválidos.' })
    }

    const pool = await getPool()
    const isOwner = await assertGroupOwnership(pool, req.params.groupId, req.user.id)
    if (!isOwner) {
      return res.status(404).json({ error: 'Grupo no encontrado.' })
    }

    await pool.query(
      `INSERT INTO public.transactions (group_id, type, amount, from_member_id, to_member_id)
       VALUES ($1, 'settlement', $2, $3, $4)`,
      [req.params.groupId, numericAmount, from, to]
    )

    const [updatedGroup] = await fetchGroups(pool, req.user.id, req.params.groupId)
    res.status(201).json(updatedGroup)
  } catch (err) {
    next(err)
  }
})

// DELETE /api/groups/:groupId/transactions/:txId — Eliminar un movimiento
router.delete('/:groupId/transactions/:txId', async (req, res, next) => {
  try {
    const pool = await getPool()
    const isOwner = await assertGroupOwnership(pool, req.params.groupId, req.user.id)
    if (!isOwner) {
      return res.status(404).json({ error: 'Grupo no encontrado.' })
    }

    await pool.query(
      'DELETE FROM public.transactions WHERE id = $1 AND group_id = $2',
      [req.params.txId, req.params.groupId]
    )
    const [updatedGroup] = await fetchGroups(pool, req.user.id, req.params.groupId)
    res.json(updatedGroup)
  } catch (err) {
    next(err)
  }
})

// POST /api/groups/seed — Cargar datos de demostración para el usuario actual
router.post('/seed', async (req, res, next) => {
  let client
  try {
    const pool = await getPool()
    client = await pool.connect()
    await client.query('BEGIN')

    const grpRes = await client.query(
      "INSERT INTO public.groups (owner_id, name) VALUES ($1, 'Cena de Viernes 🌮') RETURNING id",
      [req.user.id]
    )
    const grpId = grpRes.rows[0].id

    const names = ['Ana', 'Carlos', 'Luis', 'Sofía']
    const memberIds = []
    for (const n of names) {
      const mRes = await client.query(
        'INSERT INTO public.members (group_id, name) VALUES ($1, $2) RETURNING id',
        [grpId, n]
      )
      memberIds.push(mRes.rows[0].id)
    }

    const tx1 = await client.query(
      `INSERT INTO public.transactions (group_id, type, description, amount, paid_by, split_mode)
       VALUES ($1, 'expense', 'Tacos y aguas frescas', 840, $2, 'equal')
       RETURNING id`,
      [grpId, memberIds[0]]
    )
    for (const mId of memberIds) {
      await client.query(
        'INSERT INTO public.transaction_splits (transaction_id, member_id, amount) VALUES ($1, $2, 210)',
        [tx1.rows[0].id, mId]
      )
    }

    const tx2 = await client.query(
      `INSERT INTO public.transactions (group_id, type, description, amount, paid_by, split_mode)
       VALUES ($1, 'expense', 'Postres y café (cuenta separada)', 390, $2, 'exact')
       RETURNING id`,
      [grpId, memberIds[1]]
    )
    const customSplits = [
      [memberIds[0], 95],
      [memberIds[1], 120],
      [memberIds[3], 175],
    ]
    for (const [mId, amt] of customSplits) {
      await client.query(
        'INSERT INTO public.transaction_splits (transaction_id, member_id, amount) VALUES ($1, $2, $3)',
        [tx2.rows[0].id, mId, amt]
      )
    }

    await client.query('COMMIT')
    const groups = await fetchGroups(pool, req.user.id)
    res.status(201).json(groups)
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {})
    next(err)
  } finally {
    if (client) client.release()
  }
})

export default router
