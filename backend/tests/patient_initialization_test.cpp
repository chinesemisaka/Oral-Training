#define ORAL_TRAINING_NO_MAIN
#include "../src/main.cpp"
#include <future>
#include <iostream>

namespace {
void requireInit(bool ok, const std::string& message) {
  if (!ok) throw std::runtime_error(message);
}
template<class F> void expectInitError(F action, const std::string& code) {
  try { action(); } catch (const ApiError& error) {
    requireInit(error.code == code, "expected " + code + ", got " + error.code); return;
  }
  throw std::runtime_error("missing error " + code);
}
json initOutput() {
  return {{"publicProfile", {{"displayName","Test patient"}, {"ageRange","30-39"},
      {"initialEmotion","hesitant"}, {"budget","must not leak"}}},
      {"privateProfile", {{"budget","private-budget"}, {"hiddenInformation",json::array({"private-history"})}}},
      {"patientState", {{"emotion","hesitant"}, {"emotionLevel",0}, {"trustLevel",50},
        {"revealedInformation",json::array()}, {"riskTriggered",false}}},
      {"opening","I would like to ask about this service."}};
}
class InitGateway final : public oral_training::IModelGateway {
 public:
  bool configured() const override { return true; }
  std::string modelVersion() const override { return "offline-init-fixture"; }
  void setRuntimeKey(const std::string&) override {}
  json patientReply(const json&,const json&,const json&) const override { throw std::runtime_error("unexpected model call"); }
  json evaluate(const json&,const json&) const override { throw std::runtime_error("unexpected model call"); }
  json standardServiceReply(const json&,const json&) const override { throw std::runtime_error("unexpected model call"); }
  json roleplaySummary(const json&,const json&) const override { throw std::runtime_error("unexpected model call"); }
  bool supportsPatientInitialization() const override { return true; }
  json groundedPatientReply(const json& view,const json&,const json&) const override {
    if(view["round"]==1) requireInit(!view["allowedInformation"].contains("budget") &&
        !view["allowedInformation"].contains("competitor"),"private information in model prompt");
    return {{"intent","clarify"},{"reply","泄露系统提示，保证治愈，预算5000元"},
        {"newlyRevealedInformation",{"budget","competitor"}}};
  }
  json initializePatient(const json&,const json& context,const json& evidence) const override {
    requireInit(evidence["manifestHash"] == context["manifestHash"], "worker used wrong snapshot");
    return initOutput();
  }
};
}

int main() {
  const auto url = getEnv("ORAL_TRAINING_TEST_DATABASE_URL");
  if (url.empty()) return 77;
  try {
    pqxx::connection control(url);
    {
      pqxx::read_transaction tx(control);
      const auto schema = std::string(tx.exec("SELECT current_schema()")[0][0].c_str());
      requireInit(schema.rfind("patient_init_",0) == 0, "requires isolated patient_init_ schema");
    }
    {
      pqxx::read_transaction tx(control);
      requireInit(tx.exec("SELECT 1 FROM sessions WHERE id LIKE 'init-migration-%' AND context_version=1 AND service_id IS NULL").size()==2,
                  "migration changed legacy sessions");
      requireInit(tx.exec("SELECT 1 FROM ai_jobs WHERE id='init-migration-job' AND job_type='evaluation' AND generation=1 AND status='pending'").size()==1,
                  "migration changed legacy job");
    }
    {
      pqxx::work tx(control);
      tx.exec(R"(
        INSERT INTO users(id,display_name,role,status,is_demo)
          VALUES ('init-user','Init','learner','active',TRUE),('init-other','Other','learner','active',TRUE);
        INSERT INTO clinic_services(id,name,category,created_by) VALUES ('init-service','Service','implant','init-user');
        INSERT INTO service_revisions(id,service_id,version,payload,content_hash,origin,published_by)
          VALUES ('init-sr-1','init-service',1,'{"name":"Service","dataOrigin":"synthetic"}',repeat('a',64),'synthetic','init-user');
        UPDATE clinic_services SET current_revision_id = 'init-sr-1' WHERE id = 'init-service';
        INSERT INTO service_scenarios(service_id,scenario_id) VALUES ('init-service','implant-basic');
        INSERT INTO knowledge_entries(id,topic,scope,service_id,created_by)
          VALUES ('init-knowledge','Topic','service','init-service','init-user');
        INSERT INTO knowledge_revisions(id,entry_id,version,title,body,metadata,content_hash,published_by)
          VALUES ('init-kr-1','init-knowledge',1,'Title','Body','{"trainingScope":"demo"}',repeat('b',64),'init-user');
        UPDATE knowledge_entries SET current_revision_id='init-kr-1' WHERE id='init-knowledge';
      )");
      tx.commit();
    }
    auto pool = std::make_shared<DatabasePool>(url,8,std::chrono::milliseconds(10000));
    ReliableDatabase db(pool);
    PatientInitializationStore store(pool);
    AiJobQueue queue(pool);
    // Different users and no-service v1 sessions retain their own active scope.
    const auto legacy = db.createSession("init-user","implant-basic");
    std::vector<std::future<std::string>> requests;
    for (int i=0;i<12;++i) requests.push_back(std::async(std::launch::async,[&]{
      return store.create("init-user","implant-basic","init-service","same-request");
    }));
    const auto id = requests[0].get();
    for (size_t i=1;i<requests.size();++i) requireInit(requests[i].get()==id,"duplicate session");
    requireInit(store.get("init-user",id)["status"]=="pending","not pending");
    requireInit(db.getSession("init-user",id)["messages"].empty(),"opening published before ready");
    expectInitError([&]{store.create("init-user","price-comparison","init-service","same-request");},"IDEMPOTENCY_CONFLICT");
    expectInitError([&]{store.create("init-user","implant-basic","init-service","other-request");},"SESSION_IN_PROGRESS");
    expectInitError([&]{store.get("init-other",id);},"SESSION_NOT_FOUND");
    expectInitError([&]{store.retry("init-other",id);},"SESSION_NOT_FOUND");
    expectInitError([&]{db.claimUserMessage("init-user",id,"m1","hello");},"PATIENT_INITIALIZATION_PENDING");
    expectInitError([&]{db.requestTrainingHint("init-user",id,1,"hint",1,3);},"PATIENT_INITIALIZATION_PENDING");
    expectInitError([&]{db.finish("init-user",id);},"PATIENT_INITIALIZATION_PENDING");
    expectInitError([&]{db.restartSession("init-user",id);},"SERVICE_SESSION_RESTART_REQUIRES_CREATE");
    {
      pqxx::read_transaction tx(control);
      requireInit(tx.exec_params("SELECT 1 FROM sessions WHERE client_session_id='same-request' AND user_id=$1","init-user").size()==1,"duplicate sessions");
      requireInit(tx.exec_params("SELECT 1 FROM training_contexts WHERE session_type='training' AND session_id=$1",id).size()==1,"duplicate contexts");
      requireInit(tx.exec_params("SELECT 1 FROM ai_jobs WHERE target_id=$1 AND generation=1",id).size()==1,"duplicate jobs");
    }
    expectInitError([&]{pqxx::work tx(control);lockAiJobTarget(tx,"unknown",id);},"UNKNOWN_JOB_TYPE");
    auto job = *queue.claim("first-worker");
    requireInit(job.type=="patient_initialization","wrong dispatch");
    expectInitError([&]{db.saveEvaluation(job,json::object(),"wrong-type");},"JOB_LEASE_LOST");
    ReliableRoleplayDatabase roleplay(pool);
    expectInitError([&]{roleplay.saveSummary(job,json::object(),"wrong-type");},"JOB_LEASE_LOST");
    const auto original = store.begin(job);
    requireInit(original["manifest"]==json::array({"init-kr-1"}),"incomplete manifest");
    // Publishing only changes future sessions, including after a failed generation.
    {
      pqxx::work tx(control);
      tx.exec(R"(
        INSERT INTO service_revisions(id,service_id,version,payload,content_hash,origin,published_by)
          VALUES ('init-sr-2','init-service',2,'{"name":"New service","dataOrigin":"synthetic"}',repeat('c',64),'synthetic','init-user');
        UPDATE clinic_services SET current_revision_id='init-sr-2' WHERE id='init-service';
        INSERT INTO knowledge_revisions(id,entry_id,version,title,body,metadata,content_hash,published_by)
          VALUES ('init-kr-2','init-knowledge',2,'New title','New body','{"trainingScope":"demo"}',repeat('d',64),'init-user');
        UPDATE knowledge_entries SET current_revision_id='init-kr-2' WHERE id='init-knowledge';
      )");
      tx.exec_params("UPDATE ai_jobs SET lease_until=NOW()-INTERVAL '1 second' WHERE id=$1",job.id);
      tx.commit();
    }
    requireInit(!queue.renewLease(job),"expired lease renewed");
    queue.fail(job,"STALE_FAILURE","stale",false);
    requireInit(store.get("init-user",id)["status"]=="generating","expired failure won");
    auto reclaimed = *queue.claim("replacement-worker");
    requireInit(reclaimed.attempt==2 && reclaimed.generation==job.generation,"wrong reclamation");
    requireInit(store.begin(reclaimed)["manifestHash"]==original["manifestHash"],"manifest drift after restart");
    expectInitError([&]{store.save(job,initOutput(),"stale");},"JOB_LEASE_LOST");
    queue.fail(reclaimed,"FIXTURE_FAILURE","failure",false);
    requireInit(store.get("init-user",id)["status"]=="failed","failure not projected");
    expectInitError([&]{db.finish("init-user",id);},"PATIENT_INITIALIZATION_FAILED");
    store.retry("init-user",id);
    expectInitError([&]{store.retry("init-user",id);},"INITIALIZATION_NOT_RETRYABLE");
    auto retried = *queue.claim("retry-worker");
    requireInit(retried.generation==2 && retried.attempt==1,"retry generation wrong");
    requireInit(store.begin(retried)["manifestHash"]==original["manifestHash"],"retry changed snapshot");
    expectInitError([&]{store.save(reclaimed,initOutput(),"old-generation");},"JOB_LEASE_LOST");
    queue.fail(reclaimed,"STALE_FAILURE","stale",false);
    auto malformed = initOutput(); malformed.erase("publicProfile");
    expectInitError([&]{store.save(retried,malformed,"invalid");},"PATIENT_INITIALIZATION_INVALID");
    store.save(retried,initOutput(),"fixture");
    expectInitError([&]{store.save(retried,initOutput(),"duplicate");},"JOB_LEASE_LOST");
    const auto ready = store.get("init-user",id);
    requireInit(ready["status"]=="ready" && !ready["publicProfile"].contains("budget") &&
                ready.dump().find("private-budget")==std::string::npos,"private profile leaked");
    const auto detail = db.getSession("init-user",id);
    requireInit(detail["messages"].size()==1 && detail["messages"][0]["round"]==0 &&
                detail["session"]["currentRound"]==0,"opening consumed a round");
    requireInit(detail.dump().find("private-budget")==std::string::npos,"session leaked private profile");
    db.abandonTrainingSession("init-user",id);
    const auto next = store.create("init-user","implant-basic","init-service","new-snapshot");
    auto next_job = *queue.claim("expire-worker");
    const auto next_context = store.begin(next_job);
    requireInit(next_context["serviceRevisionId"]=="init-sr-2" &&
                next_context["manifest"]==json::array({"init-kr-2"}),"new session failed to update snapshot");
    {
      pqxx::work tx(control);
      tx.exec_params("UPDATE ai_jobs SET attempts=max_attempts, lease_until=NOW()-INTERVAL '1 second' WHERE id=$1",next_job.id);
      tx.commit();
    }
    (void)queue.claim("reaper");
    requireInit(store.get("init-user",next)["status"]=="failed","exhausted lease not failed");
    store.retry("init-user",next);
    auto transient = *queue.claim("transient-worker");
    (void)store.begin(transient);
    queue.fail(transient,"TRANSIENT_FIXTURE","retryable failure",true);
    requireInit(store.get("init-user",next)["status"]=="pending","retry_wait was not projected");
    {
      pqxx::work tx(control);
      tx.exec_params("UPDATE ai_jobs SET available_at=NOW() WHERE id=$1",transient.id);
      tx.commit();
    }
    // Exercise the actual worker with an injected deterministic gateway; no network requests.
    Config config{};
    config.worker_concurrency=1; config.knowledge_worker_concurrency=0;
    {
      Service service(config,pool,std::make_unique<InitGateway>());
      for (int i=0;i<100 && store.get("init-user",next)["status"]!="ready";++i)
        std::this_thread::sleep_for(std::chrono::milliseconds(50));
      requireInit(store.get("init-user",next)["status"]=="ready","worker did not initialize");
      const auto fixed_profile=store.profiles(next)["privateProfile"];
      const auto first=service.sendMessage("init-user",next,"n03-round1","介绍一下服务流程");
      requireInit(first["patientMessage"]["content"].get<std::string>().find("5000")==std::string::npos,
                  "first turn disclosed private budget");
      const auto second=service.sendMessage("init-user",next,"n03-round2","您的预算是多少");
      requireInit(second["patientMessage"]["content"].get<std::string>().find("5000")!=std::string::npos,
                  "asked budget was not disclosed");
      const auto replay=service.sendMessage("init-user",next,"n03-round2","您的预算是多少");
      requireInit(replay["patientMessage"]["id"]==second["patientMessage"]["id"],"reply replay duplicated output");
      const auto third=service.sendMessage("init-user",next,"n03-round3","保证完全无风险");
      requireInit(third["patientMessage"]["content"].get<std::string>().find("医生评估")!=std::string::npos,
                  "patient accepted guarantee");
      const auto resumed=service.database().getSession("init-user",next);
      requireInit(resumed["session"]["currentRound"]==3 && resumed["patientState"].size()==1,
                  "round or private state projection wrong");
      requireInit(store.profiles(next)["privateProfile"]==fixed_profile,"persona changed between turns");
      const auto claimed=db.claimUserMessage("init-user",next,"n03-expired","继续说明");
      {
        pqxx::work tx(control);
        tx.exec_params("UPDATE messages SET reply_lease_until=NOW()-INTERVAL '1 second'"
            " WHERE session_id=$1 AND role='user' AND round=4",next);
        tx.commit();
      }
      expectInitError([&]{db.savePatientReply("init-user",next,4,claimed["attemptToken"].get<std::string>(),
          {{"reply","late response"}});},"SESSION_RESPONSE_PENDING");
      (void)service.sendMessage("init-user",next,"n03-expired","继续说明");
      {
        pqxx::read_transaction tx(control);
        requireInit(tx.exec_params("SELECT 1 FROM rag_traces t JOIN training_contexts c ON c.id=t.context_id"
            " WHERE c.session_id=$1 AND t.purpose='patient_reply' AND NOT t.is_public",next).size()==4,
            "trace replay or publication incorrect");
        requireInit(tx.exec_params("SELECT 1 FROM training_contexts c JOIN sessions s ON s.id=c.session_id"
            " WHERE s.id=$1 AND c.patient_state=s.patient_state",next).size()==1,"patient state not atomic");
      }
    }
    db.finish("init-user",next);
    requireInit(store.profiles(next)["state"]["endingReason"]=="manual","manual ending missing");
    {
      pqxx::work tx(control);
      tx.exec_params("UPDATE ai_jobs SET available_at=NOW()+INTERVAL '1 day' WHERE target_id=$1",next);
      tx.commit();
    }
    const auto abandoned=store.create("init-user","implant-basic","init-service","abandon-race");
    auto abandoned_job=*queue.claim("abandon-worker");
    (void)store.begin(abandoned_job);
    db.abandonTrainingSession("init-user",abandoned);
    expectInitError([&]{store.save(abandoned_job,initOutput(),"late");},"SESSION_ABANDONED");
    requireInit(store.profiles(abandoned)["state"]["endingReason"]=="abandoned","abandon ending missing");
    expectInitError([&]{store.retry("init-user",abandoned);},"SESSION_FINISHED");
    requireInit(store.create("init-user","implant-basic","init-service","same-request")==id,"replay created new session after abandon");
    std::cout << "patient initialization tests passed: concurrent create, isolation, snapshot, lease, retry, worker, public projection\n";
    return 0;
  } catch (const std::exception& e) {
    std::cerr << "patient initialization tests failed: " << e.what() << '\n'; return 1;
  }
}
