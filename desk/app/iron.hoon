::  iron: a dumbbell workout tracker. owner-only json api under /apps/iron/api:
::
::    GET    /state            workouts, bodyweights, settings
::    POST   /workout          {day, at?, note, entries: [{ex, sets: [{lbs, reps}]}]}
::    DELETE /workout/<id>
::    POST   /weight           {lbs, at?}
::    DELETE /weight/<id>
::    POST   /settings         any json up to 4 kB
::
::    weights are tenths of a pound (125 = 12.5 lb); at is unix ms
::
/+  default-agent, dbug, server
|%
+$  set      [lbs=@ud reps=@ud]
+$  entry    [ex=@t sets=(list set)]
+$  workout  [id=@ud day=@t at=@da note=@t entries=(list entry)]
+$  weigh    [id=@ud at=@da lbs=@ud]
+$  versioned-state  $%(state-0)
::  workouts and weights: newest first
+$  state-0
  $:  %0
      next=@ud
      workouts=(list workout)
      weights=(list weigh)
      settings=(unit @t)
  ==
+$  card  card:agent:gall
--
::
%-  agent:dbug
=|  state-0
=*  state  -
^-  agent:gall
=<
|_  =bowl:gall
+*  this  .
    def   ~(. (default-agent this %|) bowl)
    hc    ~(. +> bowl)
++  on-init
  ^-  (quip card _this)
  :_  this
  [%pass /eyre/connect %arvo %e %connect [~ /apps/iron] dap.bowl]~
++  on-save  !>(state)
++  on-load  |=(old=vase `this(state !<(versioned-state old)))
++  on-poke
  |=  [=mark =vase]
  ^-  (quip card _this)
  ?.  ?=(%handle-http-request mark)  (on-poke:def mark vase)
  =+  !<([eyre-id=@ta req=inbound-request:eyre] vase)
  =^  cards  state  (handle:hc eyre-id req)
  [cards this]
++  on-watch
  |=  =path
  ^-  (quip card _this)
  ?:  ?=([%http-response @ ~] path)  `this
  (on-watch:def path)
++  on-arvo
  |=  [=wire =sign-arvo]
  ^-  (quip card _this)
  ?.  ?=([%eyre %connect ~] wire)  (on-arvo:def wire sign-arvo)
  `this
++  on-peek
  |=  =path
  ^-  (unit (unit cage))
  ?+  path  (on-peek:def path)
    [%x %workouts ~]  ``noun+!>(workouts)
    [%x %weights ~]   ``noun+!>(weights)
  ==
++  on-agent  on-agent:def
++  on-leave  on-leave:def
++  on-fail   on-fail:def
--
::
|_  =bowl:gall
++  handle
  |=  [eyre-id=@ta req=inbound-request:eyre]
  ^-  (quip card state-0)
  =/  give  (cury give-simple-payload:app:server eyre-id)
  ?.  authenticated.req
    =/  rl  (parse-request-line:server url.request.req)
    ?:  ?=([%apps %iron %api *] site.rl)  [(give [[403 ~] ~]) state]
    [(give (login-redirect:gen:server request.req)) state]
  =/  site=(list @t)
    =/  s  site:(parse-request-line:server url.request.req)
    ?.(?=([%apps %iron *] s) ~ t.t.s)
  =*  method  method.request.req
  =/  jon=(unit json)
    ?~  body.request.req  ~
    (de:json:html q.u.body.request.req)
  ?+    site  [(give not-found:gen:server) state]
      ~           [(give (ok 'text/html' (file /web/index/html))) state]
      [%app ~]    [(give (ok 'text/javascript' (file /web/app/js))) state]
      [%data ~]   [(give (ok 'text/javascript' (file /web/data/js))) state]
      [%style ~]  [(give (ok 'text/css' (file /web/style/css))) state]
      [%icon ~]   [(give (ok 'image/png' (file /web/icon/png))) state]
  ::
      [%api %state ~]
    [(give (json-response:gen:server state-json)) state]
  ::
      [%api %workout ~]
    ?.  ?=(%'POST' method)  [(give [[405 ~] ~]) state]
    =/  w  ?~(jon ~ (parse-workout u.jon))
    ?~  w  [(give [[400 ~] ~]) state]
    =/  new=workout  u.w(id next)
    ::  keep the list newest first, whatever date the workout was logged for
    ::
    =/  all  (sort [new workouts] |=([a=workout b=workout] (gth at.a at.b)))
    :-  (give (json-response:gen:server (workout-json new)))
    state(next +(next), workouts all)
  ::
      [%api %workout @ ~]
    =/  id  (slaw %ud i.t.t.site)
    ?.  &(?=(^ id) ?=(%'DELETE' method))  [(give [[400 ~] ~]) state]
    [(give [[204 ~] ~]) state(workouts (skip workouts |=(w=workout =(id.w u.id))))]
  ::
      [%api %weight ~]
    ?.  ?=(%'POST' method)  [(give [[405 ~] ~]) state]
    =/  lbs  ?~(jon ~ (num (field u.jon 'lbs')))
    ?~  lbs  [(give [[400 ~] ~]) state]
    ?:  |(=(0 u.lbs) (gth u.lbs 10.000))  [(give [[400 ~] ~]) state]
    =/  =weigh  [next (at-of jon) u.lbs]
    =/  all  (sort [weigh weights] |=([a=^weigh b=^weigh] (gth at.a at.b)))
    :-  (give (json-response:gen:server (weigh-json weigh)))
    state(next +(next), weights all)
  ::
      [%api %weight @ ~]
    =/  id  (slaw %ud i.t.t.site)
    ?.  &(?=(^ id) ?=(%'DELETE' method))  [(give [[400 ~] ~]) state]
    [(give [[204 ~] ~]) state(weights (skip weights |=(w=weigh =(id.w u.id))))]
  ::
      [%api %settings ~]
    ?.  ?=(%'POST' method)  [(give [[405 ~] ~]) state]
    ?~  body.request.req  [(give [[400 ~] ~]) state]
    ?.  &(?=(^ jon) (lte p.u.body.request.req 4.096))  [(give [[400 ~] ~]) state]
    [(give [[204 ~] ~]) state(settings `q.u.body.request.req)]
  ==
::
++  ok
  |=  [type=@t =octs]
  ^-  simple-payload:http
  [[200 ['content-type' type]~] `octs]
++  file
  |=  =path
  ^-  octs
  (as-octs:mimes:html .^(@t %cx (weld /(scot %p our.bowl)/[q.byk.bowl]/(scot %da now.bowl) path)))
::
::  json in
::
++  field
  |=  [j=json k=@t]
  ^-  json
  ?.  ?=([%o *] j)  ~
  (fall (~(get by p.j) k) ~)
++  num
  |=  j=json
  ^-  (unit @ud)
  ?.  ?=([%n *] j)  ~
  (rush p.j dem)
++  str
  |=  j=json
  ^-  (unit @t)
  ?.(?=([%s *] j) ~ `p.j)
::  +at-of: optional "at" (unix ms), else now
++  at-of
  |=  jon=(unit json)
  ^-  @da
  ?~  jon  now.bowl
  =/  ms  (num (field u.jon 'at'))
  ?~  ms  now.bowl
  (add ~1970.1.1 (div (mul u.ms ~s1) 1.000))
::
++  parse-workout
  |=  j=json
  ^-  (unit workout)
  =/  day  (str (field j 'day'))
  ?~  day  ~
  =/  note  (fall (str (field j 'note')) '')
  =/  es  (field j 'entries')
  ?.  ?=([%a *] es)  ~
  =/  entries=(list entry)
    %+  murn  p.es
    |=  e=json
    =/  ex  (str (field e 'ex'))
    =/  ss  (field e 'sets')
    ?.  &(?=(^ ex) ?=([%a *] ss))  ~
    =/  sets=(list set)
      %+  murn  p.ss
      |=  s=json
      =/  l  (num (field s 'lbs'))
      =/  r  (num (field s 'reps'))
      ?.  &(?=(^ l) ?=(^ r) (lte u.l 2.000) (lte u.r 1.000))  ~
      `[u.l u.r]
    ?~  sets  ~
    `[u.ex sets]
  ?~  entries  ~
  ?:  (gth (met 3 note) 2.000)  ~
  `[0 u.day (at-of `j) note entries]
::
::  json out
::
++  workout-json
  |=  w=workout
  ^-  json
  =,  enjs:format
  %-  pairs
  :~  id+(numb id.w)
      day+s+day.w
      at+(time at.w)
      note+s+note.w
      :-  %entries
      :-  %a
      %+  turn  entries.w
      |=  e=entry
      %-  pairs
      :~  ex+s+ex.e
          sets+a+(turn sets.e |=(s=set (pairs ~[lbs+(numb lbs.s) reps+(numb reps.s)])))
      ==
  ==
++  weigh-json
  |=  w=weigh
  ^-  json
  =,  enjs:format
  (pairs ~[id+(numb id.w) at+(time at.w) lbs+(numb lbs.w)])
++  state-json
  ^-  json
  =,  enjs:format
  %-  pairs
  :~  ship+s+(scot %p our.bowl)
      workouts+a+(turn workouts workout-json)
      weights+a+(turn weights weigh-json)
      settings+?~(settings ~ (need (de:json:html u.settings)))
  ==
--
