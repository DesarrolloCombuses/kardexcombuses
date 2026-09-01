-- ============================================================================
-- Kardex de Dotacion -- Combuses SA
-- Convierte la "base" del vehiculo en un dato que se mantiene solo, en vez
-- de una copia estatica que solo quedaba bien el dia que se corrio el
-- UPDATE (sql/update_base_vehiculo_2026-08-27.sql). Ese UPDATE fue un
-- disparo unico: a cualquier empleado que llegara despues (nuevo ingreso,
-- cambio de vehiculo) y le tocara un numero_interno ya conocido, nunca le
-- aparecia la base sola -- quedaba en blanco hasta que alguien la escribiera
-- a mano. Caso real: BENITEZ GONZALEZ JUAN ALBERTO, numero_interno 752
-- (ingreso 2026-09-02), base vacia aunque el vehiculo 752 ya esta en la
-- lista de bases conocidas.
--
-- Esta tabla + trigger reemplazan ese mecanismo: employees.base se recalcula
-- solo cada vez que se guarda un empleado, a partir de esta tabla de
-- referencia. Si el numero_interno no esta en la referencia (vehiculo
-- nuevo que todavia no se ha agregado acá), no se toca lo que haya escrito
-- la persona a mano.
-- ============================================================================

create table if not exists vehiculo_bases (
  numero_interno text primary key,
  base text not null
);

alter table vehiculo_bases enable row level security;

drop policy if exists "vehiculo_bases access" on vehiculo_bases;
create policy "vehiculo_bases access" on vehiculo_bases
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

insert into vehiculo_bases (numero_interno, base) values
  ('15', '5'), ('17', '3'), ('25', '0'), ('30', '0'), ('45', 'FZ'),
  ('59', '5'), ('64', '5'), ('67', '0'), ('85', 'FZ'), ('89', '5'),
  ('100', '5'), ('101', 'FZ'), ('102', '0'), ('108', '0'), ('113', '0'),
  ('114', '0'), ('134', '0'), ('146', '0'), ('152', 'FZ'), ('156', '0'),
  ('157', '5'), ('163', '5'), ('165', 'FZ'), ('183', 'FC'), ('185', '0'),
  ('187', '0'), ('188', 'FC'), ('189', 'JH'), ('190', 'FZ'), ('192', 'FC'),
  ('193', '0'), ('194', '0'), ('195', '0'), ('198', 'FC'), ('204', 'AA'),
  ('211', '5'), ('216', 'FZ'), ('217', '0'), ('223', '0'), ('232', '5'),
  ('233', '0'), ('237', '0'), ('238', 'FC'), ('239', 'FZ'), ('243', '0'),
  ('251', 'DR'), ('266', 'FC'), ('268', '0'), ('269', 'GZ'), ('305', '0'),
  ('400', 'FZ'), ('500', 'FZ'), ('503', 'FZ'), ('505', '0'), ('507', '3'),
  ('508', 'FZ'), ('509', 'FZ'), ('510', '3'), ('511', 'AA'), ('512', 'FZ'),
  ('513', 'FZ'), ('514', 'FZ'), ('515', '0'), ('516', '0'), ('517', 'AA'),
  ('518', 'AA'), ('519', 'AA'), ('703', '4'), ('705', '4'), ('707', '4'),
  ('708', '5'), ('709', '3'), ('710', '3'), ('714', '3'), ('715', '4'),
  ('717', '4'), ('718', '3'), ('719', '2'), ('720', '3'), ('721', '4'),
  ('722', '3'), ('723', '3'), ('724', '3'), ('725', '4'), ('726', '3'),
  ('727', '3'), ('728', '4'), ('729', '1'), ('730', '1'), ('731', '4'),
  ('732', '1'), ('733', '5'), ('734', '3'), ('735', '4'), ('736', '8'),
  ('737', '3'), ('738', '3'), ('739', '3'), ('740', '3'), ('741', '3'),
  ('742', '3'), ('743', '3'), ('744', '3'), ('745', '3'), ('746', '4'),
  ('747', '5'), ('748', '2'), ('749', '2'), ('750', '3'), ('751', '3'),
  ('752', '3'), ('753', '3'), ('754', '3'), ('755', '3'), ('756', '8'),
  ('757', '5'), ('758', '3'), ('759', '3')
on conflict (numero_interno) do update set base = excluded.base;

create or replace function sync_employee_base_from_vehiculo()
returns trigger
language plpgsql
as $$
declare
  base_encontrada text;
begin
  if new.numero_interno is null then
    new.base := null;
  else
    select vb.base into base_encontrada
    from vehiculo_bases vb
    where vb.numero_interno = new.numero_interno;

    if found then
      new.base := base_encontrada;
    end if;
    -- si el vehiculo no esta en vehiculo_bases todavia, se deja lo que
    -- haya llegado en el guardado (permite completar a mano mientras se
    -- agrega ese vehiculo a la tabla de referencia).
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_employee_base on employees;
create trigger trg_sync_employee_base
  before insert or update on employees
  for each row execute function sync_employee_base_from_vehiculo();

-- Backfill: corrige de una vez a quienes ya tenían un numero_interno
-- conocido pero base en blanco (como el caso de BENITEZ GONZALEZ arriba).
update employees e set base = vb.base
from vehiculo_bases vb
where e.numero_interno = vb.numero_interno
  and (e.base is null or e.base <> vb.base);
