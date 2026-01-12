create view stock_index_hourly as
select
  date_trunc('hour', timestamp) as timestamp_bucket,
  portfolio,
  describe,
  avg(value::numeric) as value
from stock_index
group by 1, 2, 3
order by 1;

create view stock_index_daily as
select
  date_trunc('day', timestamp) as timestamp_bucket,
  portfolio,
  describe,
  avg(value::numeric) as value
from stock_index
group by 1, 2, 3
order by 1;

grant select on stock_index_hourly, stock_index_daily to anon;