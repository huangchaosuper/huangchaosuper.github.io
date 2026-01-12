create view coin_index_hourly as
select
  date_trunc('hour', ts) as ts_bucket,
  portfolio,
  avg(value::numeric) as value
from coin_index
group by 1, 2
order by 1;

create view coin_index_daily as
select
  date_trunc('day', ts) as ts_bucket,
  portfolio,
  avg(value::numeric) as value
from coin_index
group by 1, 2
order by 1;

grant select on coin_index_hourly, coin_index_daily to anon;